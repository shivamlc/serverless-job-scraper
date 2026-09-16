# specs/12-multi-environment-cicd.md
# No secrets here — alert_email is supplied separately as TF_VAR_alert_email
# from the GitHub "uat" Environment's own variables.

environment     = "uat"
enable_schedule = false # infra exists for manual testing; no real cron (spec 12)
