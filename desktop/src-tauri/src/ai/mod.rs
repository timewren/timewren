pub mod anthropic;
pub mod google;
pub mod ollama;
pub mod openai;
pub mod openrouter;
pub mod ordbogen;
pub mod prompt;
pub mod sanitize;

use crate::i18n;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub provider: String, // "openai" | "anthropic" | "google" | "ollama" | "ordbogen" | "openrouter"
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>, // For Ollama, Ordbogen.ai, or OpenRouter custom endpoints
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationRequest {
    pub activities: Vec<ActivityForAi>,
    pub projects: Vec<ProjectForAi>,
    pub rules_context: Vec<String>,
    pub patterns_context: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityForAi {
    pub index: usize,
    pub app_name: String,
    pub window_title: String,
    pub url: Option<String>,
    pub git_branch: Option<String>,
    pub git_repo: Option<String>,
    /// Project directory derived from the process tree (constant-title apps).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_path: Option<String>,
    pub duration: i64,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectForAi {
    pub id: String,
    pub name: String,
    pub client_name: Option<String>,
    pub keywords: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationResult {
    pub classifications: Vec<ClassifiedActivity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifiedActivity {
    pub index: usize,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub category: String,
    pub confidence: f64,
    pub billable: bool,
    pub reasoning: String,
}

/// Find the byte index of the `}` that balances the `{` at `start`.
///
/// Tracks brace depth while skipping braces inside JSON string literals
/// (honouring backslash escapes). Returns `None` if the braces never balance
/// (e.g. a truncated response).
fn balanced_brace_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, &b) in bytes[start..].iter().enumerate() {
        let i = start + offset;
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/// Extract a JSON object from text that may contain surrounding prose.
///
/// For every `{` in the text we compute its balanced closing `}` (ignoring
/// braces inside string literals and their escapes) and return the first such
/// span that actually parses as a JSON value. This is more robust than a naive
/// first-`{`/last-`}` slice in two ways:
///
/// 1. Stray braces in the model's prose (e.g. "use `{curly}` braces") do not
///    corrupt the slice — `{curly}` is balanced but not valid JSON, so it is
///    skipped and the real object is found.
/// 2. Braces appearing inside JSON string values are not mistaken for
///    structural braces.
///
/// If no span parses as JSON, falls back to the first balanced span so callers
/// still get a best-effort slice (their `from_str` will surface the error).
///
/// Used by AI providers whose response may contain markdown or explanatory
/// text around the JSON object.
pub fn extract_json(text: &str) -> Option<&str> {
    let bytes = text.as_bytes();
    let mut first_balanced: Option<&str> = None;

    let mut search_from = 0;
    while let Some(rel) = text[search_from..].find('{') {
        let start = search_from + rel;
        if let Some(end) = balanced_brace_end(bytes, start) {
            // `{` and `}` are ASCII, so these byte indices are char boundaries.
            let candidate = &text[start..=end];
            if first_balanced.is_none() {
                first_balanced = Some(candidate);
            }
            if serde_json::from_str::<serde_json::Value>(candidate).is_ok() {
                return Some(candidate);
            }
        }
        // Advance past this `{` and keep looking for a parseable object.
        search_from = start + 1;
    }

    first_balanced
}

/// Maximum number of activities to classify in a single API call.
/// Prevents excessive token usage and timeouts.
pub const MAX_BATCH_SIZE: usize = 50;

/// Classify a batch of activities using the configured AI provider.
///
/// The result is validated and sanitised: invalid project IDs are removed,
/// confidence is clamped, categories are verified, and reasoning is truncated.
pub async fn classify_batch(
    config: &AiConfig,
    request: &ClassificationRequest,
) -> Result<ClassificationResult, String> {
    // Enforce batch size limit
    let capped_request = if request.activities.len() > MAX_BATCH_SIZE {
        ClassificationRequest {
            activities: request.activities[..MAX_BATCH_SIZE].to_vec(),
            projects: request.projects.clone(),
            rules_context: request.rules_context.clone(),
            patterns_context: request.patterns_context.clone(),
        }
    } else {
        request.clone()
    };

    let (system_prompt, user_prompt) = prompt::build_classification_prompt(&capped_request);

    let raw_result = match config.provider.as_str() {
        "openai" => openai::classify(config, &system_prompt, &user_prompt).await,
        "anthropic" => anthropic::classify(config, &system_prompt, &user_prompt).await,
        "google" => google::classify(config, &system_prompt, &user_prompt).await,
        "ollama" => ollama::classify(config, &system_prompt, &user_prompt).await,
        "ordbogen" => ordbogen::classify(config, &system_prompt, &user_prompt).await,
        "openrouter" => openrouter::classify(config, &system_prompt, &user_prompt).await,
        _ => Err(i18n::t_fmt("error.unknownAiProvider", &[&config.provider])),
    }?;

    // Validate and sanitise the AI output
    let valid_project_ids: Vec<String> = capped_request
        .projects
        .iter()
        .map(|p| p.id.clone())
        .collect();

    Ok(sanitize::validate_classification_result(
        &raw_result,
        &valid_project_ids,
    ))
}

/// A group of activities with the same app+title+git identity, merged for more
/// efficient AI classification.
#[derive(Debug)]
pub struct ActivityGroup {
    pub activity: ActivityForAi,
    /// Original (activity_id, original_index) pairs that this group represents.
    pub member_ids: Vec<i64>,
    pub session_count: usize,
}

/// Key identifying a group: (app_name, window_title, git_repo, git_branch,
/// context_path). Git and process-context are part of the identity so two
/// windows that share an app name and window title but belong to DIFFERENT
/// projects (e.g. two editor windows both titled "main.rs", or one Orca window
/// spanning many project folders) are not merged into one group — which would
/// otherwise write the AI's single answer back to BOTH projects' activities.
type GroupKey = (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// Groups activities by (app_name, window_title, git_repo, git_branch,
/// context_path), summing durations and merging metadata. Returns grouped
/// activities ready for AI classification and a mapping from group index back
/// to original activity IDs.
pub fn group_activities(activities: &[(i64, ActivityForAi)]) -> Vec<ActivityGroup> {
    let mut groups: HashMap<GroupKey, ActivityGroup> = HashMap::new();
    let mut order: Vec<GroupKey> = Vec::new();

    for (id, activity) in activities {
        let key = (
            activity.app_name.clone(),
            activity.window_title.clone(),
            activity.git_repo.clone(),
            activity.git_branch.clone(),
            activity.context_path.clone(),
        );

        if let Some(group) = groups.get_mut(&key) {
            group.activity.duration += activity.duration;
            group.member_ids.push(*id);
            group.session_count += 1;
            if group.activity.git_branch.is_none() {
                group.activity.git_branch = activity.git_branch.clone();
            }
            if group.activity.git_repo.is_none() {
                group.activity.git_repo = activity.git_repo.clone();
            }
            if group.activity.url.is_none() {
                group.activity.url = activity.url.clone();
            }
        } else {
            order.push(key.clone());
            groups.insert(
                key,
                ActivityGroup {
                    activity: ActivityForAi {
                        index: 0,
                        app_name: activity.app_name.clone(),
                        window_title: activity.window_title.clone(),
                        url: activity.url.clone(),
                        git_branch: activity.git_branch.clone(),
                        git_repo: activity.git_repo.clone(),
                        context_path: activity.context_path.clone(),
                        duration: activity.duration,
                        started_at: activity.started_at.clone(),
                        session_count: None,
                    },
                    member_ids: vec![*id],
                    session_count: 1,
                },
            );
        }
    }

    let mut result: Vec<ActivityGroup> = order
        .into_iter()
        .filter_map(|key| groups.remove(&key))
        .collect();

    for (idx, group) in result.iter_mut().enumerate() {
        group.activity.index = idx;
        if group.session_count > 1 {
            group.activity.session_count = Some(group.session_count);
        }
    }

    result
}

/// Test the connection to the configured AI provider.
pub async fn test_connection(config: &AiConfig) -> Result<String, String> {
    match config.provider.as_str() {
        "openai" => openai::test(config).await,
        "anthropic" => anthropic::test(config).await,
        "google" => google::test(config).await,
        "ollama" => ollama::test(config).await,
        "ordbogen" => ordbogen::test(config).await,
        "openrouter" => openrouter::test(config).await,
        _ => Err(i18n::t_fmt("error.unknownAiProvider", &[&config.provider])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn activity(
        app: &str,
        title: &str,
        git_repo: Option<&str>,
        duration: i64,
    ) -> ActivityForAi {
        ActivityForAi {
            index: 0,
            app_name: app.to_string(),
            window_title: title.to_string(),
            url: None,
            git_branch: None,
            git_repo: git_repo.map(str::to_string),
            context_path: None,
            duration,
            started_at: "2026-01-01T00:00:00Z".to_string(),
            session_count: None,
        }
    }

    #[test]
    fn group_merges_same_app_title_and_git() {
        let input = vec![
            (1, activity("code", "main.rs", Some("repoA"), 10)),
            (2, activity("code", "main.rs", Some("repoA"), 5)),
        ];
        let groups = group_activities(&input);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].activity.duration, 15);
        assert_eq!(groups[0].member_ids, vec![1, 2]);
        assert_eq!(groups[0].session_count, 2);
    }

    #[test]
    fn group_splits_same_title_different_repo() {
        // Core bug: identical app + title but different git_repo must NOT merge,
        // otherwise one AI answer is written back to both projects' activities.
        let input = vec![
            (1, activity("code", "main.rs", Some("repoA"), 10)),
            (2, activity("code", "main.rs", Some("repoB"), 7)),
        ];
        let groups = group_activities(&input);
        assert_eq!(groups.len(), 2);
        // Member ids stay disjoint, one per repo.
        assert_eq!(groups[0].member_ids, vec![1]);
        assert_eq!(groups[1].member_ids, vec![2]);
    }

    #[test]
    fn group_merges_browser_without_git() {
        // No git (browsers/AI tools): identical app+title still groups as one.
        let input = vec![
            (1, activity("chrome", "Gmail", None, 4)),
            (2, activity("chrome", "Gmail", None, 6)),
        ];
        let groups = group_activities(&input);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].activity.duration, 10);
    }

    #[test]
    fn group_splits_different_title() {
        let input = vec![
            (1, activity("code", "main.rs", Some("repoA"), 3)),
            (2, activity("code", "lib.rs", Some("repoA"), 3)),
        ];
        let groups = group_activities(&input);
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn extract_json_simple_object() {
        assert_eq!(extract_json("{\"a\":1}"), Some("{\"a\":1}"));
    }

    #[test]
    fn extract_json_with_surrounding_prose() {
        let input = "Here is the answer:\n{\"a\":1}\nHope that helps!";
        assert_eq!(extract_json(input), Some("{\"a\":1}"));
    }

    #[test]
    fn extract_json_ignores_stray_braces_in_prose() {
        // The naive first-`{`/last-`}` approach would grab from the prose `{`
        // all the way to the trailing prose `}`, corrupting the slice. The
        // balanced scan must return exactly the JSON object.
        let input = "Note: use {curly} braces. {\"a\":1} (done) }extra{";
        assert_eq!(extract_json(input), Some("{\"a\":1}"));
    }

    #[test]
    fn extract_json_ignores_braces_inside_string_literals() {
        let input = "{\"note\":\"a } close and { open in text\",\"a\":1}";
        assert_eq!(extract_json(input), Some(input));
    }

    #[test]
    fn extract_json_handles_escaped_quotes_in_strings() {
        // The escaped quote must not end the string early, so the `}` inside
        // the string stays ignored.
        let input = "{\"q\":\"he said \\\"}\\\" loudly\",\"a\":1}";
        assert_eq!(extract_json(input), Some(input));
    }

    #[test]
    fn extract_json_handles_nested_objects() {
        let input = "prefix {\"outer\":{\"inner\":2}} suffix";
        assert_eq!(extract_json(input), Some("{\"outer\":{\"inner\":2}}"));
    }

    #[test]
    fn extract_json_returns_none_when_unbalanced() {
        // Open brace never closes (e.g. truncated response).
        assert_eq!(extract_json("{\"a\":1"), None);
    }

    #[test]
    fn extract_json_returns_none_without_brace() {
        assert_eq!(extract_json("no json here"), None);
    }

    #[test]
    fn group_preserves_first_seen_order() {
        let input = vec![
            (1, activity("code", "z.rs", Some("r"), 1)),
            (2, activity("chrome", "a", None, 1)),
        ];
        let groups = group_activities(&input);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].activity.app_name, "code");
        assert_eq!(groups[1].activity.app_name, "chrome");
        // index is reassigned sequentially after grouping
        assert_eq!(groups[0].activity.index, 0);
        assert_eq!(groups[1].activity.index, 1);
    }
}
