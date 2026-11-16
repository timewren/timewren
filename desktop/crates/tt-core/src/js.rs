//! JavaScript-tal i Rust: de få primitiver, web-reglerne hviler på, med
//! præcis samme resultat som i browseren og Node.
//!
//! Web regner i `f64` ligesom Rust, så de fleste regnestykker er ens af sig
//! selv. Forskellene ligger i afrunding og tekst:
//!
//! - `Math.round` runder halve op mod +∞ (`-2.5` → `-2`), Rusts `f64::round`
//!   runder væk fra nul.
//! - `toFixed` runder den EKSAKTE decimalværdi af tallet, og et eksakt
//!   midtpunkt går til den største størrelse (`0.125.toFixed(2)` = `"0.13"`,
//!   `1.005.toFixed(2)` = `"1.00"`). Rusts `format!("{:.2}")` runder et
//!   midtpunkt til lige ciffer (`"0.12"`).
//! - `Intl.NumberFormat`/`toLocaleString` runder i stedet den KORTESTE
//!   decimalform (`1.005` → "1,01"). Web bruger begge: `toFixed` når beløb
//!   gemmes, `Intl` når de vises.
//! - `parseFloat` læser det længste tal-præfiks (`"2.5t"` → 2,5) og giver NaN
//!   for resten.

/// `Math.round(x)`: nærmeste heltal, et midtpunkt runder op mod +∞.
pub fn round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let floor = x.floor();
    // x - floor er eksakt for alle endelige f64 (floor ligger inden for 1 af x)
    let r = if x - floor >= 0.5 { floor + 1.0 } else { floor };
    // Math.round(-0.4) er -0
    if r == 0.0 && x.is_sign_negative() {
        -0.0
    } else {
        r
    }
}

/// `parseFloat(s)`: længste gyldige decimal-præfiks efter indledende
/// whitespace; NaN hvis der ikke er noget.
pub fn parse_float(s: &str) -> f64 {
    let t = s.trim_start();
    let bytes = t.as_bytes();
    let mut i = 0;
    if i < bytes.len() && (bytes[i] == b'+' || bytes[i] == b'-') {
        i += 1;
    }
    if t[i..].starts_with("Infinity") {
        return if bytes.first() == Some(&b'-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    let digits_start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    let mut mantissa_digits = i - digits_start;
    if i < bytes.len() && bytes[i] == b'.' {
        let dot = i;
        i += 1;
        let frac_start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        mantissa_digits += i - frac_start;
        if mantissa_digits == 0 {
            i = dot;
        }
    }
    if mantissa_digits == 0 {
        return f64::NAN;
    }
    // Eksponent kun hvis der følger mindst ét ciffer
    if i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
        let mut j = i + 1;
        if j < bytes.len() && (bytes[j] == b'+' || bytes[j] == b'-') {
            j += 1;
        }
        let exp_start = j;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            j += 1;
        }
        if j > exp_start {
            i = j;
        }
    }
    t[..i].parse::<f64>().unwrap_or(f64::NAN)
}

/// `Number(s)` for de strenge, klokkeslæt-felterne kan indeholde: tom (eller
/// kun whitespace) er 0, ellers skal hele strengen være et decimaltal.
pub fn number(s: &str) -> f64 {
    let t = s.trim();
    if t.is_empty() {
        return 0.0;
    }
    let bytes = t.as_bytes();
    let ok = bytes
        .iter()
        .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'+' | b'-' | b'e' | b'E'))
        && bytes.iter().any(u8::is_ascii_digit);
    if !ok {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// Afrund |x| til `digits` decimaler på den eksakte decimalværdi, midtpunkt
/// væk fra nul (`toFixed`). Giver (heltalsdel, decimaler) som cifferstrenge.
fn exact_round_abs(x: f64, digits: usize) -> (String, String) {
    // En f64 har højst 1074 binære decimaler, så 1100 decimale cifre er eksakt.
    round_decimal_str(&format!("{:.1100}", x.abs()), digits)
}

/// Afrund |x| til `digits` decimaler på den KORTESTE decimalform, der giver
/// tallet tilbage (1.005 → "1.005"), midtpunkt væk fra nul. Det er hvad
/// `Intl.NumberFormat`/`toLocaleString` gør i V8 (ICU): `1.005` vises som
/// "1,01", selvom `(1.005).toFixed(2)` er "1.00".
fn shortest_round_abs(x: f64, digits: usize) -> (String, String) {
    // Rusts Display for f64 er netop den korteste rundtur-form, uden eksponent.
    round_decimal_str(&format!("{}", x.abs()), digits)
}

fn round_decimal_str(s: &str, digits: usize) -> (String, String) {
    let (int_part, frac_part) = s.split_once('.').unwrap_or((s, ""));
    let mut digits_vec: Vec<u8> = int_part
        .bytes()
        .chain(
            frac_part
                .bytes()
                .chain(std::iter::repeat(b'0'))
                .take(digits),
        )
        .collect();
    let rest = frac_part.as_bytes().get(digits..).unwrap_or(&[]);
    // Midtpunkt eller derover: første fjernede ciffer >= 5
    if rest.first().is_some_and(|d| *d >= b'5') {
        let mut k = digits_vec.len();
        loop {
            if k == 0 {
                digits_vec.insert(0, b'1');
                break;
            }
            k -= 1;
            if digits_vec[k] == b'9' {
                digits_vec[k] = b'0';
            } else {
                digits_vec[k] += 1;
                break;
            }
        }
    }
    let split = digits_vec.len() - digits;
    let int_digits = String::from_utf8(digits_vec[..split].to_vec()).unwrap_or_default();
    let frac_digits = String::from_utf8(digits_vec[split..].to_vec()).unwrap_or_default();
    let int_digits = int_digits.trim_start_matches('0');
    (
        if int_digits.is_empty() {
            "0".to_string()
        } else {
            int_digits.to_string()
        },
        frac_digits,
    )
}

/// `x.toFixed(digits)` for |x| < 1e21.
pub fn to_fixed(x: f64, digits: usize) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 {
            "Infinity".into()
        } else {
            "-Infinity".into()
        };
    }
    let (int_digits, frac_digits) = exact_round_abs(x, digits);
    // toFixed skriver kun minus for x < 0 (ikke for -0)
    let sign = if x < 0.0 { "-" } else { "" };
    if digits == 0 {
        format!("{sign}{int_digits}")
    } else {
        format!("{sign}{int_digits}.{frac_digits}")
    }
}

/// `x` afrundet som `toFixed(2)` (eksakt værdi, midtpunkt væk fra nul) og
/// givet i hundrededele: kroner → øre, som web GEMMER beløb.
pub fn to_hundredths(x: f64) -> i64 {
    hundredths(x, exact_round_abs)
}

/// `x` afrundet som `Intl`/`toLocaleString` med 2 decimaler (korteste
/// decimalform, midtpunkt væk fra nul) og givet i hundrededele: kroner → øre,
/// som web VISER beløb (fx på faktura-PDF'en).
pub fn to_hundredths_intl(x: f64) -> i64 {
    hundredths(x, shortest_round_abs)
}

fn hundredths(x: f64, round_abs: fn(f64, usize) -> (String, String)) -> i64 {
    if !x.is_finite() {
        return 0;
    }
    let (int_digits, frac_digits) = round_abs(x, 2);
    let magnitude: i64 = format!("{int_digits}{frac_digits}")
        .parse()
        .unwrap_or(i64::MAX);
    if x < 0.0 { -magnitude } else { magnitude }
}

/// `new Intl.NumberFormat("da-DK", { minimumFractionDigits, maximumFractionDigits }).format(x)`:
/// punktum som tusindtalsseparator, komma som decimaltegn, overflødige nuller
/// til sidst udeladt ned til `min_frac`. Runder den korteste decimalform
/// (1.005 → "1,01"), se [`shortest_round_abs`].
pub fn format_da(x: f64, min_frac: usize, max_frac: usize) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "∞".into() } else { "-∞".into() };
    }
    let (int_digits, frac_digits) = shortest_round_abs(x, max_frac);
    let mut frac = frac_digits.trim_end_matches('0').to_string();
    while frac.len() < min_frac {
        frac.push('0');
    }
    let mut grouped = String::new();
    for (i, ch) in int_digits.chars().enumerate() {
        if i > 0 && (int_digits.len() - i) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(ch);
    }
    // Intl skriver også "-0" for -0 og for negative tal, der runder til 0
    let sign = if x.is_sign_negative() { "-" } else { "" };
    if frac.is_empty() {
        format!("{sign}{grouped}")
    } else {
        format!("{sign}{grouped},{frac}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn math_round_runder_halve_op() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(0.49999999999999994), 0.0);
        assert_eq!(round(1.38 * 60.0 / 15.0), 6.0);
    }

    #[test]
    fn to_fixed_runder_den_eksakte_vaerdi() {
        assert_eq!(to_fixed(0.125, 2), "0.13");
        assert_eq!(to_fixed(1.005, 2), "1.00");
        assert_eq!(to_fixed(2.675, 2), "2.67");
        assert_eq!(to_fixed(-1.005, 2), "-1.00");
        assert_eq!(to_fixed(3525.0, 2), "3525.00");
        assert_eq!(to_fixed(0.3, 0), "0");
    }

    #[test]
    fn parse_float_som_js() {
        assert_eq!(parse_float("25.75"), 25.75);
        assert_eq!(parse_float(" 2.5t"), 2.5);
        assert_eq!(parse_float(".5"), 0.5);
        assert_eq!(parse_float("1e3x"), 1000.0);
        assert_eq!(parse_float("1e"), 1.0);
        assert!(parse_float("abc").is_nan());
        assert!(parse_float("").is_nan());
        assert!(parse_float(".").is_nan());
    }

    #[test]
    fn dansk_talformat() {
        assert_eq!(format_da(1250.0, 0, 2), "1.250");
        assert_eq!(format_da(712.5, 0, 2), "712,5");
        assert_eq!(format_da(1234567.891, 0, 2), "1.234.567,89");
        assert_eq!(format_da(0.125, 0, 2), "0,13");
        assert_eq!(format_da(20.0, 2, 2), "20,00");
    }
}
