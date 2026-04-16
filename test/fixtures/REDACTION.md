# Fixture redaction rules

All fixtures in `live/` are captured from real GSC API responses against sitefire.ai.
Before committing, apply these redaction rules:

1. **Query strings**: Remove any query containing a customer name, personal name,
   or sensitive intent. Replace with `[redacted-query]` if needed for structure.
2. **Referring URLs**: Strip any referring URL that could leak non-sitefire data.
3. **OAuth tokens**: If accidentally captured, delete immediately. Token fields
   should never appear in fixtures.
4. **Email addresses**: Remove any email from `permissionLevel` or related fields.
5. **Internal URLs**: Keep sitefire.ai URLs. Remove any non-sitefire URL from
   inspection results unless it's a well-known public site.

Synthetic fixtures in `synthetic/` are hand-crafted and contain no real data.
