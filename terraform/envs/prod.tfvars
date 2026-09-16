# specs/12-multi-environment-cicd.md
# No secrets here — alert_email is supplied separately as TF_VAR_alert_email
# from the GitHub "prod" Environment's own variables.

environment     = "prod"
enable_schedule = true # the only environment that actually runs the recurring scrape
