variable "cloud_id" {
  description = "Yandex Cloud identifier for production."
  type        = string
  sensitive   = true
}

variable "folder_id" {
  description = "Yandex Cloud folder identifier for production."
  type        = string
  sensitive   = true
}

variable "zone" {
  description = "Approved Yandex Cloud availability zone."
  type        = string
}
