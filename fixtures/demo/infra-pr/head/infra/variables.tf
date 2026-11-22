variable "name" {
  description = "Prefix for resource names."
  type        = string
  default     = "users"
}

variable "location" {
  description = "Azure region for every resource."
  type        = string
  default     = "canadacentral"
}

variable "avatar_sizes" {
  description = "Widths, in pixels, each uploaded avatar is resized to."
  type        = list(number)
  default     = [64, 256]
}
