# HCode Signing Secrets

Configure these GitHub Actions repository secrets to enable signed installers.

## Windows (Authenticode)

- `HCODE_WINDOWS_CERT_PFX_BASE64`: Base64 content of your `.pfx` code signing certificate.
- `HCODE_WINDOWS_CERT_PASSWORD`: Password for the `.pfx` certificate.

Helper command to generate base64:

```bash
base64 -i certificate.pfx | pbcopy
```

## macOS (Developer ID + Notarization)

- `HCODE_MACOS_CERT_P12_BASE64`: Base64 content of your Developer ID `.p12` certificate.
- `HCODE_MACOS_CERT_PASSWORD`: Password for the `.p12` certificate.
- `HCODE_MACOS_SIGN_IDENTITY`: Signing identity, for example `Developer ID Application: Your Company (TEAMID)`.

Notarization secrets:

- `HCODE_MACOS_NOTARY_APPLE_ID`: Apple ID used for notarization.
- `HCODE_MACOS_NOTARY_APP_PASSWORD`: App-specific password for that Apple ID.
- `HCODE_MACOS_NOTARY_TEAM_ID`: Apple Developer Team ID.

Helper command to generate base64:

```bash
base64 -i certificate.p12 | pbcopy
```

## Notes

- If a secret is not configured, the workflow keeps building unsigned artifacts.
- Once secrets are configured, signatures and notarization run automatically on each build.
