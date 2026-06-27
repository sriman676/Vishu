# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately via GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(the **Security** tab → *Report a vulnerability*), or by email to **srimanrutvik224@gmail.com**.

Include a description, reproduction steps, and the impact you see. Expect an initial response within a few days. Once a fix ships, credit is given unless you prefer to stay anonymous.

## Scope

Vishu is local-first and loopback-bound by default. Areas of particular interest:

- The agent's shell/file execution and its `SecurityPolicy` (command classification, path jail, prompt-injection guard).
- The JSON-RPC transport (bearer token, CORS allowlist).
- The optional `wallet` module's keystore.
- Any path by which a model or a fetched web page could exfiltrate secrets or escape the action directory.

Secrets belong in env or the OS keychain — never in the vault or the model context. If you find a path that violates that, it's in scope.

## Not a substitute for a professional audit

The project's security posture is AI-assisted and self-reviewed. Independent review is welcome.
