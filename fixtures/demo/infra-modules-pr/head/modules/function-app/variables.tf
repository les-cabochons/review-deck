variable "name" {
  type = string
}

variable "location" {
  type = string
}

variable "storage_account_name" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "queue_name" {
  type        = string
  description = "The queue the function app reads resize requests from."
}
