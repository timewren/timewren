//! Indbygget lokal model via llama.cpp (llama-cpp-2). Kører i appens egen proces.
//!
//! Svaret er tvunget i form af en GBNF-grammatik, så selv en lille model kun
//! kan svare med gyldig JSON og et kandidatnummer, der findes.

use crate::prompt::{self, SYSTEM_PROMPT};
use crate::types::{
    AiError, BlockSummary, Candidate, Classification, Classifier, ProviderInfo, ProviderKind,
};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use llama_cpp_2::token::data::LlamaTokenData;
use llama_cpp_2::token::data_array::LlamaTokenDataArray;
use std::num::NonZeroU32;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Indstillinger for den lokale model.
#[derive(Debug, Clone)]
pub struct LocalModelOptions {
    /// Kontekstlængde i tokens. Prompten er typisk 300-1.500 tokens.
    pub n_ctx: u32,
    /// Lag på GPU (Metal/CUDA/Vulkan). 0 = kun CPU.
    pub gpu_layers: u32,
    /// CPU-tråde. `None` = halvdelen af kernerne (appen skal ikke tage hele maskinen).
    pub threads: Option<i32>,
    /// Samlet tidsgrænse for ét svar.
    pub timeout: Duration,
    /// Maks. genererede tokens.
    pub max_tokens: usize,
}

impl Default for LocalModelOptions {
    fn default() -> Self {
        Self {
            n_ctx: 4096,
            gpu_layers: 999,
            threads: None,
            timeout: Duration::from_secs(20),
            max_tokens: 160,
        }
    }
}

/// Måling af én generering.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GenerationStats {
    pub prompt_tokens: usize,
    pub generated_tokens: usize,
    pub prompt_ms: u128,
    pub generate_ms: u128,
}

impl GenerationStats {
    pub fn tokens_per_sec(&self) -> f64 {
        if self.generate_ms == 0 {
            0.0
        } else {
            self.generated_tokens as f64 * 1000.0 / self.generate_ms as f64
        }
    }
}

fn backend() -> Result<&'static LlamaBackend, AiError> {
    static BACKEND: OnceLock<Result<LlamaBackend, String>> = OnceLock::new();
    BACKEND
        .get_or_init(|| {
            // llama.cpp og ggml (inkl. Metal-init) logger ellers direkte til stderr.
            llama_cpp_2::send_logs_to_tracing(
                llama_cpp_2::LogOptions::default().with_logs_enabled(false),
            );
            LlamaBackend::init().map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(|e| AiError::Model(format!("llama.cpp kunne ikke starte: {e}")))
}

/// En indlæst model. Kald serialiseres, så kun én kontekst lever ad gangen.
pub struct LocalLlm {
    model: LlamaModel,
    name: String,
    opts: LocalModelOptions,
    lock: Mutex<()>,
}

impl LocalLlm {
    /// Indlæser en GGUF-fil (tager et par sekunder; kør i baggrunden).
    pub fn load(path: &Path, name: &str, opts: LocalModelOptions) -> Result<Self, AiError> {
        // Før llama.cpp røres: en processor uden AVX2 ville gå ned her.
        crate::cpu::local_model_supported()
            .map_err(|missing| AiError::UnsupportedCpu(missing.join(", ")))?;
        if !path.exists() {
            return Err(AiError::ModelLoad(format!(
                "modelfilen findes ikke: {}",
                path.display()
            )));
        }
        let params = LlamaModelParams::default().with_n_gpu_layers(opts.gpu_layers);
        let model = LlamaModel::load_from_file(backend()?, path, &params)
            .map_err(|e| AiError::ModelLoad(e.to_string()))?;
        Ok(Self {
            model,
            name: name.to_string(),
            opts,
            lock: Mutex::new(()),
        })
    }

    /// Genererer et svar på en system- og brugerprompt, evt. bundet af en grammatik.
    pub fn generate(
        &self,
        system: &str,
        user: &str,
        grammar: Option<&str>,
    ) -> Result<(String, GenerationStats), AiError> {
        let _g = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let start = Instant::now();
        let m = |e: &dyn std::fmt::Display| AiError::Model(e.to_string());

        let tmpl = self.model.chat_template(None).map_err(|e| m(&e))?;
        let chat = vec![
            LlamaChatMessage::new("system".into(), system.into()).map_err(|e| m(&e))?,
            LlamaChatMessage::new("user".into(), user.into()).map_err(|e| m(&e))?,
        ];
        let text = self
            .model
            .apply_chat_template(&tmpl, &chat, true)
            .map_err(|e| m(&e))?;
        // Skabelonen indeholder selv BOS-tekst, hvor modellen bruger det.
        let tokens = self.model.vocab().tokenize(text.as_bytes(), false, true);
        let n_ctx = self.opts.n_ctx as usize;
        if tokens.is_empty() {
            return Err(AiError::Model("tom prompt".into()));
        }
        if tokens.len() + self.opts.max_tokens >= n_ctx {
            return Err(AiError::Model(format!(
                "prompten er for lang ({} tokens)",
                tokens.len()
            )));
        }

        let threads = self.opts.threads.unwrap_or_else(|| {
            let n = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4);
            (n / 2).max(1) as i32
        });
        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(self.opts.n_ctx))
            .with_n_batch(self.opts.n_ctx)
            .with_n_threads(threads)
            .with_n_threads_batch(threads);
        let mut ctx = self
            .model
            .new_context(backend()?, ctx_params)
            .map_err(|e| m(&e))?;

        let mut batch = LlamaBatch::new(n_ctx, 1);
        let last = tokens.len() - 1;
        for (i, t) in tokens.iter().enumerate() {
            batch
                .add(*t, i as i32, &[0], i == last)
                .map_err(|e| m(&e))?;
        }
        ctx.decode(&mut batch).map_err(|e| m(&e))?;
        let prompt_done = Instant::now();

        let mut grammar = match grammar {
            Some(g) => Some(LlamaSampler::grammar(&self.model, g, "root").map_err(|e| m(&e))?),
            None => None,
        };

        let vocab = self.model.vocab();
        let mut out = Vec::<u8>::new();
        let mut pos = tokens.len() as i32;
        let mut generated = 0usize;
        while generated < self.opts.max_tokens {
            if start.elapsed() > self.opts.timeout {
                return Err(AiError::Timeout(self.opts.timeout));
            }
            let token = next_token(&ctx, batch.n_tokens() - 1, grammar.as_mut());
            if vocab.is_eog(token) {
                break;
            }
            out.extend(vocab.token_to_piece(token, false, None));
            generated += 1;
            batch.clear();
            batch.add(token, pos, &[0], true).map_err(|e| m(&e))?;
            pos += 1;
            ctx.decode(&mut batch).map_err(|e| m(&e))?;
        }
        let stats = GenerationStats {
            prompt_tokens: tokens.len(),
            generated_tokens: generated,
            prompt_ms: (prompt_done - start).as_millis(),
            generate_ms: prompt_done.elapsed().as_millis(),
        };
        Ok((String::from_utf8_lossy(&out).into_owned(), stats))
    }

    /// Som [`Classifier::classify`], men returnerer også målingen.
    pub fn classify_with_stats(
        &self,
        block: &BlockSummary,
        candidates: &[Candidate],
    ) -> Result<(Option<Classification>, GenerationStats), AiError> {
        let candidates = &candidates[..candidates.len().min(prompt::MAX_CANDIDATES)];
        let grammar = prompt::gbnf_grammar(candidates.len());
        let (text, stats) = self.generate(
            SYSTEM_PROMPT,
            &prompt::user_prompt(block, candidates),
            Some(&grammar),
        )?;
        let parsed = prompt::parse_answer(&text, candidates.len())?;
        Ok((parsed.into_classification(candidates), stats))
    }
}

/// Greedy valg af næste token, evt. bundet af grammatikken.
///
/// Som llama.cpp's egen sampler prøves det bedste token først mod
/// grammatikken; kun hvis det afvises, køres grammatikken over hele
/// ordforrådet (ca. 150.000 tokens). Det giver omtrent den dobbelte hastighed.
fn next_token(
    ctx: &llama_cpp_2::context::LlamaContext<'_>,
    idx: i32,
    grammar: Option<&mut LlamaSampler>,
) -> LlamaToken {
    let logits = ctx.get_logits_ith(idx);
    let (best, best_logit) =
        logits
            .iter()
            .enumerate()
            .fold((0usize, f32::NEG_INFINITY), |acc, (i, &l)| {
                if l > acc.1 { (i, l) } else { acc }
            });
    let best = LlamaToken(best as i32);
    let Some(g) = grammar else {
        return best;
    };
    let mut one = LlamaTokenDataArray::new(vec![LlamaTokenData::new(best, best_logit, 0.0)], false);
    one.apply_sampler(g);
    let token = if one.data[0].logit().is_finite() {
        best
    } else {
        let mut all = ctx.token_data_array_ith(idx);
        all.apply_sampler(g);
        all.sample_token_greedy()
    };
    g.accept(token);
    token
}

impl Classifier for LocalLlm {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: format!("local:{}", self.name),
            kind: ProviderKind::LocalModel,
            model: self.name.clone(),
            sends_data_off_device: false,
        }
    }

    fn classify(
        &self,
        block: &BlockSummary,
        candidates: &[Candidate],
    ) -> Result<Option<Classification>, AiError> {
        if candidates.is_empty() {
            return Ok(None);
        }
        self.classify_with_stats(block, candidates).map(|(c, _)| c)
    }
}
