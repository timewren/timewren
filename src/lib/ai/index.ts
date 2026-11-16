// AI module exports

export {
  type CategorizationInput,
  type CategorizationResult,
  type Client,
  categorizeTask,
  type Project,
} from "./categorizer";
export {
  clearUserAICache,
  DEFAULT_MODEL,
  getOpenAI,
  getOpenAIForUser,
  isAIEnabled,
  isAIEnabledForUser,
} from "./openai";
export {
  aiPrioritization,
  type DeferredTask,
  type FocusTask,
  getTodaysFocus,
  type PrioritizationResult,
  type PrioritizationWarning,
  scorePrioritization,
  type TaskForPrioritization,
} from "./prioritizer";
export {
  buildSafePrompt,
  detectInjectionAttempt,
  sanitizeEmail,
  sanitizeForPrompt,
  sanitizeList,
} from "./sanitize";
export {
  type EmailInput,
  type ParsedTask,
  parseEmailToTask,
  parseTextToTask,
} from "./task-parser";
export {
  calculateAccuracy,
  estimateTaskTime,
  formatEstimate,
  keywordEstimation,
  type TimeBreakdown,
  type TimeEstimationInput,
  type TimeEstimationResult,
} from "./time-estimator";
