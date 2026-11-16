//! Læser hovedet på en GGUF-fil: arkitektur, navn, størrelse, kvantisering og
//! kontekstlængde. Kun læsning, kun hovedet (de første kilobytes), og
//! tokenizerens store lister springes over uden at blive læst ind.
//!
//! Filen genkendes på de fire første bytes (`GGUF`), ikke på filnavnet.

use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

pub const MAGIC: &[u8; 4] = b"GGUF";

/// Højst så mange nøgle/værdi-par læses, før hovedet opgives som ødelagt.
const MAX_KV: u64 = 100_000;
/// Længste nøgle eller streng, der læses ind i hukommelsen.
const MAX_STRING: u64 = 1 << 20;
/// Tokenizerens lister ligger efter modellens egne nøgler. Er vi nået så langt
/// og har det vi skal bruge, stopper vi.
const TOKENIZER_PREFIX: &str = "tokenizer.";

/// Hvorfor hovedet ikke kunne læses.
#[derive(Debug, PartialEq, Eq)]
pub enum GgufError {
    /// De første bytes er ikke `GGUF`.
    NotGguf,
    /// Versionen kendes ikke (kun 2 og 3 findes).
    Version(u32),
    /// Filen er for kort eller har umulige størrelser.
    Corrupt,
    Io(io::ErrorKind),
}

impl From<io::Error> for GgufError {
    fn from(e: io::Error) -> Self {
        if e.kind() == io::ErrorKind::UnexpectedEof {
            GgufError::Corrupt
        } else {
            GgufError::Io(e.kind())
        }
    }
}

/// Det, vi bruger fra hovedet.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct GgufInfo {
    pub version: u32,
    pub tensor_count: u64,
    /// `general.architecture`, fx `llama`, `qwen3`, `bert`.
    pub architecture: Option<String>,
    /// `general.name`, fx "Qwen3 4B Instruct".
    pub name: Option<String>,
    /// `general.size_label`, fx "4B" eller "8x7B".
    pub size_label: Option<String>,
    pub parameter_count: Option<u64>,
    /// llama.cpps `LLAMA_FTYPE_*`.
    pub file_type: Option<u32>,
    /// `<arch>.context_length`.
    pub context_length: Option<u64>,
    /// `<arch>.pooling_type`: sat på embedding-modeller.
    pub pooling_type: Option<u64>,
}

/// Spring bytes over uden at smide læsebufferen væk (`BufReader::seek_relative`):
/// et almindeligt `seek` ville læse 64 KB igen for hver nøgle.
pub trait Skip {
    fn skip(&mut self, n: i64) -> io::Result<()>;
}

impl<R: Read + Seek> Skip for BufReader<R> {
    fn skip(&mut self, n: i64) -> io::Result<()> {
        self.seek_relative(n)
    }
}

impl<T: AsRef<[u8]>> Skip for io::Cursor<T> {
    fn skip(&mut self, n: i64) -> io::Result<()> {
        self.seek(SeekFrom::Current(n)).map(|_| ())
    }
}

/// Sand hvis filens første fire bytes er `GGUF`. Læser kun de fire bytes.
pub fn is_gguf(path: &Path) -> bool {
    let mut magic = [0u8; 4];
    File::open(path)
        .and_then(|mut f| f.read_exact(&mut magic))
        .is_ok()
        && &magic == MAGIC
}

/// Læser hovedet fra en fil.
pub fn read_header(path: &Path) -> Result<GgufInfo, GgufError> {
    let file = File::open(path)?;
    parse_header(&mut BufReader::with_capacity(64 * 1024, file))
}

/// Læser hovedet fra en vilkårlig kilde (tests bruger et `Cursor`).
pub fn parse_header<R: Read + Skip>(r: &mut R) -> Result<GgufInfo, GgufError> {
    let mut magic = [0u8; 4];
    r.read_exact(&mut magic)
        .map_err(|_| GgufError::NotGguf)?;
    if &magic != MAGIC {
        return Err(GgufError::NotGguf);
    }
    let version = read_u32(r)?;
    if !(2..=3).contains(&version) {
        return Err(GgufError::Version(version));
    }
    let tensor_count = read_u64(r)?;
    let kv_count = read_u64(r)?;
    if kv_count > MAX_KV {
        return Err(GgufError::Corrupt);
    }
    let mut info = GgufInfo {
        version,
        tensor_count,
        ..Default::default()
    };
    for _ in 0..kv_count {
        let key = read_string(r)?;
        let ty = read_u32(r)?;
        if key.starts_with(TOKENIZER_PREFIX) && info.architecture.is_some() {
            // Resten er tokenizer; modellens egne nøgler er læst.
            break;
        }
        let arch = info.architecture.clone();
        match (key.as_str(), ty) {
            ("general.architecture", 8) => info.architecture = Some(read_string(r)?),
            ("general.name", 8) => info.name = Some(read_string(r)?),
            ("general.size_label", 8) => info.size_label = Some(read_string(r)?),
            ("general.parameter_count", _) => info.parameter_count = read_uint(r, ty)?,
            ("general.file_type", _) => info.file_type = read_uint(r, ty)?.map(|v| v as u32),
            (k, _) if arch.as_deref().is_some_and(|a| k == format!("{a}.context_length")) => {
                info.context_length = read_uint(r, ty)?
            }
            (k, _) if arch.as_deref().is_some_and(|a| k == format!("{a}.pooling_type")) => {
                info.pooling_type = read_uint(r, ty)?
            }
            _ => skip_value(r, ty)?,
        }
    }
    Ok(info)
}

fn read_u32<R: Read>(r: &mut R) -> Result<u32, GgufError> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}

fn read_u64<R: Read>(r: &mut R) -> Result<u64, GgufError> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b)?;
    Ok(u64::from_le_bytes(b))
}

fn read_string<R: Read>(r: &mut R) -> Result<String, GgufError> {
    let len = read_u64(r)?;
    if len > MAX_STRING {
        return Err(GgufError::Corrupt);
    }
    let mut buf = vec![0u8; len as usize];
    r.read_exact(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Heltalsværdi af en given GGUF-type. `None` hvis typen ikke er et heltal
/// (værdien springes så over).
fn read_uint<R: Read + Skip>(r: &mut R, ty: u32) -> Result<Option<u64>, GgufError> {
    Ok(match ty {
        0 | 1 => Some(read_n(r, 1)? as u64),
        2 | 3 => Some(read_n(r, 2)? as u64),
        4 | 5 => Some(read_n(r, 4)? as u64),
        10 | 11 => Some(read_u64(r)?),
        other => {
            skip_value(r, other)?;
            None
        }
    })
}

fn read_n<R: Read>(r: &mut R, n: usize) -> Result<u32, GgufError> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b[..n])?;
    Ok(u32::from_le_bytes(b))
}

/// Bytes pr. element for de faste typer.
fn fixed_size(ty: u32) -> Option<u64> {
    match ty {
        0 | 1 | 7 => Some(1),
        2 | 3 => Some(2),
        4..=6 => Some(4),
        10..=12 => Some(8),
        _ => None,
    }
}

fn skip_value<R: Read + Skip>(r: &mut R, ty: u32) -> Result<(), GgufError> {
    if let Some(n) = fixed_size(ty) {
        r.skip(n as i64)?;
        return Ok(());
    }
    match ty {
        8 => {
            let len = read_u64(r)?;
            seek_forward(r, len)
        }
        9 => {
            let elem = read_u32(r)?;
            let len = read_u64(r)?;
            if let Some(n) = fixed_size(elem) {
                return seek_forward(r, len.checked_mul(n).ok_or(GgufError::Corrupt)?);
            }
            if elem == 8 {
                for _ in 0..len {
                    let l = read_u64(r)?;
                    seek_forward(r, l)?;
                }
                return Ok(());
            }
            // Arrays i arrays findes ikke i praksis.
            Err(GgufError::Corrupt)
        }
        _ => Err(GgufError::Corrupt),
    }
}

fn seek_forward<R: Skip>(r: &mut R, n: u64) -> Result<(), GgufError> {
    let n = i64::try_from(n).map_err(|_| GgufError::Corrupt)?;
    r.skip(n)?;
    Ok(())
}

/// Navn på `general.file_type` (llama.cpps `LLAMA_FTYPE_*`).
pub fn quantization_name(file_type: u32) -> Option<&'static str> {
    Some(match file_type {
        0 => "F32",
        1 => "F16",
        2 => "Q4_0",
        3 => "Q4_1",
        7 => "Q8_0",
        8 => "Q5_0",
        9 => "Q5_1",
        10 => "Q2_K",
        11 => "Q3_K_S",
        12 => "Q3_K_M",
        13 => "Q3_K_L",
        14 => "Q4_K_S",
        15 => "Q4_K_M",
        16 => "Q5_K_S",
        17 => "Q5_K_M",
        18 => "Q6_K",
        19 => "IQ2_XXS",
        20 => "IQ2_XS",
        21 => "Q2_K_S",
        22 => "IQ3_XS",
        23 => "IQ3_XXS",
        24 => "IQ1_S",
        25 => "IQ4_NL",
        26 => "IQ3_S",
        27 => "IQ3_M",
        28 => "IQ2_S",
        29 => "IQ2_M",
        30 => "IQ4_XS",
        31 => "IQ1_M",
        32 => "BF16",
        _ => return None,
    })
}

/// Kvantisering ud fra filnavnet, hvis hovedet ikke oplyser den
/// ("Qwen3.5-4B-Q4_K_M.gguf" → "Q4_K_M").
pub fn quantization_from_filename(name: &str) -> Option<String> {
    let upper = name.to_ascii_uppercase();
    let upper = upper.strip_suffix(".GGUF").unwrap_or(&upper);
    for token in upper.split(['-', '.', ' ']) {
        let t = token.trim();
        let rest = t.strip_prefix("IQ").or_else(|| t.strip_prefix('Q'));
        if let Some(r) = rest
            && r.chars().next().is_some_and(|c| c.is_ascii_digit())
            && r.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            return Some(t.to_string());
        }
    }
    for exact in ["BF16", "F16", "F32"] {
        if upper.split(['-', '.', ' ', '_']).any(|t| t == exact) {
            return Some(exact.to_string());
        }
    }
    None
}

/// Omtrentlig antal bits pr. vægt for en kvantisering (til at skønne
/// parameterantal ud fra filstørrelsen).
pub fn approx_bits_per_weight(quant: &str) -> f32 {
    match quant {
        "F32" => 32.0,
        "F16" | "BF16" => 16.0,
        "Q8_0" => 8.5,
        "Q6_K" => 6.6,
        "Q5_K_M" | "Q5_K_S" | "Q5_0" | "Q5_1" => 5.7,
        "Q4_0" | "Q4_1" => 4.6,
        "Q3_K_L" | "Q3_K_M" | "Q3_K_S" | "IQ3_M" | "IQ3_S" | "IQ3_XS" | "IQ3_XXS" => 3.7,
        q if q.starts_with("Q2") || q.starts_with("IQ2") => 2.8,
        q if q.starts_with("IQ1") => 1.8,
        _ => 4.9, // Q4_K_M og alt ukendt
    }
}

/// Parameterantal i milliarder ud fra "4B", "0.6B", "8x7B" eller "135M".
pub fn parse_size_label(label: &str) -> Option<f32> {
    let l = label.trim().to_ascii_uppercase();
    if let Some((n, rest)) = l.split_once('X') {
        let n: f32 = n.parse().ok()?;
        return Some(n * parse_size_label(rest)?);
    }
    // "7B-A3B" (mixture-of-experts): det samlede antal står først.
    let first = l.split(['-', '_']).next()?;
    // Filens egen tekst: del på tegngrænse, ikke bytegrænse.
    let unit = first.chars().next_back()?;
    let num = &first[..first.len() - unit.len_utf8()];
    let v: f32 = num.parse().ok()?;
    match unit {
        'B' => Some(v),
        'M' => Some(v / 1000.0),
        'T' => Some(v * 1000.0),
        'K' => Some(v / 1_000_000.0),
        _ => None,
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    //! Bygger et lille syntetisk GGUF-hoved til tests.

    pub enum Kv<'a> {
        Str(&'a str, &'a str),
        U32(&'a str, u32),
        U64(&'a str, u64),
        /// Tokenizer-agtig liste af strenge.
        StrArray(&'a str, usize),
    }

    fn put_str(out: &mut Vec<u8>, s: &str) {
        out.extend((s.len() as u64).to_le_bytes());
        out.extend(s.as_bytes());
    }

    pub fn build(version: u32, kvs: &[Kv]) -> Vec<u8> {
        let mut out = b"GGUF".to_vec();
        out.extend(version.to_le_bytes());
        out.extend(1u64.to_le_bytes());
        out.extend((kvs.len() as u64).to_le_bytes());
        for kv in kvs {
            match kv {
                Kv::Str(k, v) => {
                    put_str(&mut out, k);
                    out.extend(8u32.to_le_bytes());
                    put_str(&mut out, v);
                }
                Kv::U32(k, v) => {
                    put_str(&mut out, k);
                    out.extend(4u32.to_le_bytes());
                    out.extend(v.to_le_bytes());
                }
                Kv::U64(k, v) => {
                    put_str(&mut out, k);
                    out.extend(10u32.to_le_bytes());
                    out.extend(v.to_le_bytes());
                }
                Kv::StrArray(k, n) => {
                    put_str(&mut out, k);
                    out.extend(9u32.to_le_bytes());
                    out.extend(8u32.to_le_bytes());
                    out.extend((*n as u64).to_le_bytes());
                    for i in 0..*n {
                        put_str(&mut out, &format!("tok{i}"));
                    }
                }
            }
        }
        out
    }

    /// Et typisk chat-hoved: arkitektur, navn, størrelse, kvantisering, kontekst.
    pub fn chat(arch: &str, name: &str, size_label: &str, file_type: u32) -> Vec<u8> {
        let ctx_key = format!("{arch}.context_length");
        build(
            3,
            &[
                Kv::Str("general.architecture", arch),
                Kv::Str("general.name", name),
                Kv::Str("general.size_label", size_label),
                Kv::U32("general.file_type", file_type),
                Kv::U32(&ctx_key, 32768),
                Kv::StrArray("tokenizer.ggml.tokens", 50),
            ],
        )
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use std::io::Cursor;

    #[test]
    fn laeser_et_chat_hoved() {
        let bytes = chat("qwen3", "Qwen3 4B Instruct", "4B", 15);
        let info = parse_header(&mut Cursor::new(bytes)).unwrap();
        assert_eq!(info.architecture.as_deref(), Some("qwen3"));
        assert_eq!(info.name.as_deref(), Some("Qwen3 4B Instruct"));
        assert_eq!(info.size_label.as_deref(), Some("4B"));
        assert_eq!(info.file_type, Some(15));
        assert_eq!(info.context_length, Some(32768));
        assert_eq!(quantization_name(15), Some("Q4_K_M"));
    }

    #[test]
    fn filer_uden_magic_afvises() {
        let r = parse_header(&mut Cursor::new(b"GGML\x03\0\0\0 resten".to_vec()));
        assert_eq!(r, Err(GgufError::NotGguf));
        let r = parse_header(&mut Cursor::new(Vec::new()));
        assert_eq!(r, Err(GgufError::NotGguf));
    }

    #[test]
    fn ukendt_version_og_afkortet_hoved_er_fejl() {
        let mut v1 = b"GGUF".to_vec();
        v1.extend(1u32.to_le_bytes());
        v1.extend([0u8; 16]);
        assert_eq!(
            parse_header(&mut Cursor::new(v1)),
            Err(GgufError::Version(1))
        );
        let mut bytes = chat("llama", "x", "1B", 2);
        bytes.truncate(40);
        assert_eq!(
            parse_header(&mut Cursor::new(bytes)),
            Err(GgufError::Corrupt)
        );
    }

    #[test]
    fn umulig_antal_nøgler_giver_fejl_i_stedet_for_en_lang_løkke() {
        let mut b = b"GGUF".to_vec();
        b.extend(3u32.to_le_bytes());
        b.extend(0u64.to_le_bytes());
        b.extend(u64::MAX.to_le_bytes());
        assert_eq!(parse_header(&mut Cursor::new(b)), Err(GgufError::Corrupt));
    }

    #[test]
    fn tokenizer_foer_arkitektur_springes_over_uden_at_fejle() {
        let bytes = build(
            3,
            &[
                Kv::StrArray("tokenizer.ggml.tokens", 3),
                Kv::Str("general.architecture", "llama"),
                Kv::U64("llama.context_length", 8192),
            ],
        );
        let info = parse_header(&mut Cursor::new(bytes)).unwrap();
        assert_eq!(info.architecture.as_deref(), Some("llama"));
        assert_eq!(info.context_length, Some(8192));
    }

    #[test]
    fn pooling_type_afslører_embedding_modeller() {
        let bytes = build(
            3,
            &[
                Kv::Str("general.architecture", "qwen3"),
                Kv::U32("qwen3.pooling_type", 3),
            ],
        );
        let info = parse_header(&mut Cursor::new(bytes)).unwrap();
        assert_eq!(info.pooling_type, Some(3));
    }

    #[test]
    fn kvantisering_fra_filnavn() {
        assert_eq!(
            quantization_from_filename("Qwen3.5-4B-Q4_K_M.gguf").as_deref(),
            Some("Q4_K_M")
        );
        assert_eq!(
            quantization_from_filename("llama-3.2-1b-instruct-IQ3_XS.gguf").as_deref(),
            Some("IQ3_XS")
        );
        assert_eq!(
            quantization_from_filename("model-f16.gguf").as_deref(),
            Some("F16")
        );
        assert_eq!(quantization_from_filename("model.gguf"), None);
    }

    #[test]
    fn stoerrelsesmaerker() {
        assert_eq!(parse_size_label("4B"), Some(4.0));
        assert_eq!(parse_size_label("0.6B"), Some(0.6));
        assert_eq!(parse_size_label("8x7B"), Some(56.0));
        assert_eq!(parse_size_label("135M"), Some(0.135));
        assert_eq!(parse_size_label("30B-A3B"), Some(30.0));
        assert_eq!(parse_size_label("stor"), None);
        // Hovedet kommer fra en fil, ikke fra os: aldrig panic på ikke-ASCII.
        assert_eq!(parse_size_label("4亿"), None);
        assert_eq!(parse_size_label("亿"), None);
        assert_eq!(parse_size_label(""), None);
    }

    #[test]
    fn is_gguf_laeser_kun_magic() {
        let dir = tempfile::tempdir().unwrap();
        let ok = dir.path().join("a.gguf");
        std::fs::write(&ok, chat("llama", "x", "1B", 2)).unwrap();
        let fake = dir.path().join("b.gguf");
        std::fs::write(&fake, b"not a model").unwrap();
        assert!(is_gguf(&ok));
        assert!(!is_gguf(&fake));
        assert!(!is_gguf(&dir.path().join("findes-ikke.gguf")));
    }
}
