variable "name" {
  description = "Prefix for resource names."
  type        = string
  default     = "users"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "canadacentral"
}
