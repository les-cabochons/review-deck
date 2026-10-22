variable "subscription_id" {
  description = "Azure subscription to deploy into."
  type        = string
}

variable "name" {
  description = "Prefix for resource names; a random suffix is added."
  type        = string
  default     = "review-deck"
}

variable "location" {
  description = "Azure region. Consumption pricing is the same in most regions."
  type        = string
  default     = "eastus"
}

variable "openai_location" {
  description = "Region for the Azure OpenAI resource; it must offer titles_model as a Global Standard deployment, with quota."
  type        = string
  default     = "eastus2"
}

variable "titles_model" {
  description = <<-EOT
    Model for group titles (Global Standard deployment in an AI Services resource), or null to deploy no model: the
    page then keeps rule-based titles. Check the region offers it and the subscription has quota:
      az cognitiveservices model list -l <openai_location>   (name, version, format)
      az cognitiveservices usage list -l <openai_location>   (quota)
    format is "OpenAI" for gpt models, "Microsoft" for Phi, "xAI" for grok, and so on.
    reasoning_effort is sent to reasoning models (gpt-5 family); use "" for models without it.
    Example: { name = "Phi-4-mini-instruct", version = "1", format = "Microsoft", reasoning_effort = "" }
    Update titles_price_per_million to match the model.
  EOT
  type = object({
    name             = string
    version          = string
    format           = optional(string, "OpenAI")
    reasoning_effort = optional(string, "minimal")
  })
  default = { name = "gpt-5-nano", version = "2025-08-07" }
}

variable "titles_daily_budget_usd" {
  description = "Daily spend on group titles for the whole backend (all organizations), after which the function stops calling the model until UTC midnight. $0.025/day is at most ~$0.78/month; a PR's titles cost ~$0.0003 and are cached."
  type        = number
  default     = 0.025
}

variable "titles_caps" {
  description = <<-EOT
    Monthly (UTC) spend caps on group titles, in USD. Every organization gets org_monthly_usd and each of its
    projects project_monthly_usd, unless `orgs` overrides them. Org and project keys are names (case-insensitive);
    a project can also be keyed by its ID. Example:
      orgs = { cabochons = { monthly_usd = 1, projects = { Semantic_pr = 0.5 } } }
  EOT
  type = object({
    org_monthly_usd     = number
    project_monthly_usd = number
    orgs = optional(map(object({
      monthly_usd         = optional(number)
      project_monthly_usd = optional(number)
      projects            = optional(map(number), {})
    })), {})
  })
  default = { org_monthly_usd = 0.5, project_monthly_usd = 0.25 }
}

variable "titles_price_per_million" {
  description = "titles_model price per million tokens (USD), used to track the spending caps. Defaults are gpt-5-nano's; check the Azure OpenAI pricing page."
  type        = object({ input = number, output = number })
  default     = { input = 0.05, output = 0.4 }
}

variable "allowed_origins" {
  description = "Origins allowed to call the function from a browser: the published extension's CDN (https://<publisher>.gallerycdn.vsassets.io), plus the local dev server."
  type        = list(string)
  default     = ["https://cabochonio.gallerycdn.vsassets.io", "http://127.0.0.1:5173"]
}

variable "daily_gb_seconds_quota" {
  description = "Hard daily cap on memory-time (GB-s). The app stops for the day once reached. 2,000/day is ~62,000 GB-s/month: within the free grant, and about $1 even without it. A PR view uses roughly 1-3 GB-s."
  type        = number
  default     = 2000

  validation {
    condition     = var.daily_gb_seconds_quota > 0
    error_message = "Use a positive quota; 0 means unlimited."
  }
}

variable "monthly_budget" {
  description = "Budget alert amount, in the billing currency."
  type        = number
  default     = 1
}

variable "alert_email" {
  description = "Where budget alerts go. Leave empty to skip creating the budget."
  type        = string
  default     = ""
}

variable "ado_pat" {
  description = "Optional Azure DevOps PAT for auto-restack (Code: Read, write & manage; Pull requests). Leave empty to use the Function App's managed identity instead, which you add to the organization."
  type        = string
  default     = ""
  sensitive   = true
}

variable "extension_id" {
  description = "publisher.extension of the installed extension, whose per-project settings auto-restack reads."
  type        = string
  default     = "Cabochonio.review-deck"
}
