# VFS Global Provider (visa.vfsglobal.com)

The bot can use a second visa appointment system: **VFS Global** (e.g. https://visa.vfsglobal.com/rus/en/fra/login). It has a different site schema and a **captcha on login**.

## Setup

### 1. User record (Google Sheets)

In the **Users** sheet, set the **provider** column:

- `ais` – AIS US Visa (default)
- `vfsglobal` – VFS Global

For VFS users, use **country_code** as the locale path, e.g. `rus/en/fra` for Russia / France.

### 2. Cloudflare (“Just a moment…”)

The VFS site may show a **Cloudflare** security page (“Performing security verification” / “Just a moment…”) before the real login form. The bot:

- **Detects** this in `test-vfs-captcha` and in `VfsGlobalClient.login()`.
- If the page includes a **Turnstile** widget (with a `data-sitekey` in the HTML), it can **solve** it via 2Captcha and try to pass the challenge.
- If no Turnstile sitekey is present (challenge is JS-only), use the **`--browser`** option to pass the challenge with a headless browser (Puppeteer).

Test and debug:

```bash
npm start -- test-vfs-captcha           # detect Cloudflare / captcha type
npm start -- test-vfs-captcha --browser  # use Puppeteer to pass JS-only Cloudflare, then show login form/captcha
npm start -- test-vfs-captcha --solve   # solve Turnstile (if sitekey found) and try to pass
npm start -- test-vfs-captcha --browser --solve   # open in browser, intercept Cloudflare Turnstile params, solve via 2Captcha, then get login page
```

For `--browser`, install Puppeteer (optional): `npm install puppeteer`. Use `--browser --visible` on a machine with a display to open a real Chrome window; Cloudflare often passes in that case. In headless mode (e.g. on a server), Cloudflare frequently does **not** complete the challenge.

**Running on a server (terminal only, no display):**  
VFS is behind Cloudflare. In headless mode on a server, the “Just a moment…” challenge often never passes. Workarounds:

1. **Stealth plugin (recommended try)**  
   Install optional packages to reduce bot detection (improves pass rate on many Cloudflare sites):
   ```bash
   npm install puppeteer-extra puppeteer-extra-plugin-stealth
   ```
   Then run `test-vfs-captcha --browser` as usual. The script uses stealth when these packages are present.

2. **Prefer AIS**  
   For fully automated runs on a server, use the **AIS** provider (no Cloudflare).

3. **Other options**  
   Use 2Captcha when a Turnstile sitekey is present in the HTML (rare for this Cloudflare page), or obtain session cookies once from a desktop run with `--browser --visible` and reuse them (would require implementing cookie injection in the VFS client).

### 3. Login captcha (after Cloudflare)

Once past Cloudflare (if any), VFS login may use a captcha (image or reCAPTCHA). You can use an automatic solver or a manual callback.

#### Option A: 2Captcha (automatic, for Turnstile / reCAPTCHA / image)

1. Register at [2Captcha](https://2captcha.com).
2. Add to `.env`:
   ```env
   CAPTCHA_2CAPTCHA_API_KEY=your_api_key
   ```
3. The bot will send captchas to 2Captcha and use the solution for login (paid per solve).

#### Option B: Manual solver (callback)

Pass a custom solver when creating the bot (e.g. in code or via a wrapper script). The solver receives captcha data and must return the solved text/token.

### 4. VFS API mapping (TODO)

The current VFS client implements:

- **Login** – form submit with captcha (image or reCAPTCHA v2).
- **getAvailableDates / getAvailableTime / book** – placeholder endpoints.

To finish integration you need to:

1. Open https://visa.vfsglobal.com/rus/en/fra/login and log in manually.
2. Open DevTools → Network and go to the appointment/calendar flow.
3. Find the API calls that return available dates and time slots (and the booking POST).
4. Update `src/lib/providers/vfsglobal.ts`:
   - Set the correct URLs and query/body parameters in `checkAvailableDate`, `checkAvailableTime`, and `book`.
   - Map the response JSON to date strings (YYYY-MM-DD) and time strings.

Form field names on the login page may differ; the client tries common names (`email`, `Email`, `username`, `password`, etc.). If login fails, inspect the HTML and adjust the selectors in `vfsglobal.ts`.

## Summary

- **Provider** is chosen per user via the **provider** column (`ais` | `vfsglobal`).
- **Captcha** on VFS login is handled by 2Captcha (env key) or a custom solver.
- **Date cache** is scoped by provider so AIS and VFS do not mix.
- **VFS availability and booking** must be wired to the real VFS API using your browser’s network inspection.
