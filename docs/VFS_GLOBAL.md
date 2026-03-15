# VFS Global Provider (visa.vfsglobal.com)

The bot can use a second visa appointment system: **VFS Global** (e.g. https://visa.vfsglobal.com/rus/en/fra/login). It has a different site schema and a **captcha on login**.

## Setup

### 1. User record (Google Sheets)

All parameters that vary per user are in the **Users** sheet. The engine chooses AIS or VFS by the **provider** column. See [SETUP.md](../SETUP.md) for the full table layout.

- **provider:** `ais` – AIS US Visa (default); `vfsglobal` – VFS Global.
- **country_code:** For VFS use the locale path, e.g. `rus/en/fra` for Russia / France.
- **vfs_centre**, **vfs_category**, **vfs_subcategory:** Required for VFS; use the exact text as shown in the VFS site dropdowns (which visa type and centre). These define which appointment slot to check.

### 2. Cloudflare (“Just a moment…”)

The VFS site may show a **Cloudflare** security page (“Performing security verification” / “Just a moment…”) before the real login form. The bot:

- **Detects** this in `test-vfs-captcha` and in `VfsGlobalClient.login()`.
- If the page includes a **Turnstile** widget (with a `data-sitekey` in the HTML), it can **solve** it via 2Captcha and try to pass the challenge.
- If no Turnstile sitekey is present (challenge is JS-only), use the **`--browser`** option to pass the challenge with a headless browser (Puppeteer).

Test and debug (none of these submit credentials unless you pass `--email` and `--password`):

```bash
npm start -- test-vfs-captcha           # fetch page, detect Cloudflare / captcha type (no login)
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

### 5. Proxy for country-specific cabinet (e.g. Russia)

The **cabinet link** in the table (e.g. for Russia) is often only accessible from IPs of that country. To run the bot or capture form requests from a server outside that country, use a proxy.

**Option A: Geonix (recommended)**  
[Geonix](https://geonix.com/) (e.g. [Russian proxy](https://geonix.com/russian-proxy/)) provides IPv4 proxies by country. The bot can fetch a proxy for the required country via their API.

1. Register at [geonix.com](https://geonix.com/), buy proxies for the needed country (e.g. Russia).
2. In the [API section](https://geonix.com/personal/api/) of your dashboard, generate an API key.
3. Set in `.env` or in the **Settings** sheet:
   - **GEONIX_API_KEY** — your API key
   - **VFS_PROXY_COUNTRY** — country name (e.g. `Russia`). Default: `Russia`.
4. On startup (monitor) or when running `capture-vfs-form-requests`, the app will call `GET https://geonix.com/personal/api/v1/{apiKey}/proxy/list/ipv4`, filter by country, and use the first active proxy for the VFS browser (Puppeteer).

**Option B: Manual proxy URL**  
Set **VFS_PROXY_URL** in `.env` or Settings (overrides Geonix):

- Format: `http://login:password@host:port`  
- Example: `http://user:secret@proxy.example.com:8080`

If the provider sent you a letter with **«Авторизация»** (authorization), use the **IP and HTTP/HTTPS port** from that block as host and port; login and password are from your account (dashboard or the same letter). The «Список IP адресов» are the exit IPs (what the site sees); you connect to the auth IP and port. Example (replace `LOGIN` and `PASSWORD` with your credentials):

```env
VFS_PROXY_URL=http://LOGIN:PASSWORD@82.27.201.74:59100
```

Before first use, clear browser cache/cookies (or use a clean profile); the bot uses Puppeteer with a fresh profile, so no need to clean on the server for automated runs.

**References:**  
- [Geonix API – List proxies](https://docs.geonix.com/api-reference/proxies/list-proxies)  
- [Geonix Getting started](https://docs.geonix.com/)

### How to capture which fields are sent after login (booking form)

To see the exact API calls and request bodies when you click "Start New Booking" and select centre/category/subcategory:

1. **Manual (DevTools):** Log in to VFS in a normal browser. Open DevTools → Network, filter by XHR/fetch. Click "Start New Booking", select the three dropdowns. Inspect the new requests: URL, method, and Request Payload (body).

2. **Automated (Puppeteer):** Run:
   ```bash
   npm start -- get-vfs-login-credentials   # creates .tmp/vfs-login.json from Sheets
   npm start -- capture-vfs-form-requests --visible
   ```
   With `--visible` a browser window opens; solve the captcha and complete login if needed. The script then clicks "Start New Booking", selects centre/category/subcategory from the credentials file, and writes all XHR/fetch requests to `.tmp/vfs-captured-requests.json` (URL, method, postData). Cloudflare may block headless mode; use `--visible` and solve captcha manually.

## What the VFS page sends when the form is filled

### Login form

- **URL:** The login page is Angular (e.g. `https://visa.vfsglobal.com/kaz/en/usa/login`). The visible form has:
  - **Email** (required) — placeholder `jane.doe@email.com`
  - **Password** (required) — placeholder `**********
  - **Sign In** button (often disabled until captcha is solved)
- **Classic HTML form (when not SPA):** Our fetch-based client in `vfsglobal.ts` assumes a normal form and sends:
  - **Method:** `POST`
  - **Content-Type:** `application/x-www-form-urlencoded`
  - **Body:** all `input[name]` from the form (except `type=submit` / `type=image`), plus:
    - Email field: `email` / `Email` / `username` (from input type=email or name containing "mail"/"user")
    - Password field: `password` / `Password`
    - Captcha: `g-recaptcha-response` (reCAPTCHA v2), or `cf-turnstile-response` (Cloudflare Turnstile), or a custom name for image captcha (e.g. `captcha`, `captcha_response`)
  - **Action URL:** taken from `form[action]` (absolute or relative to login page).
- **Cloudflare first:** If the page returns “Just a moment…”, the client first POSTs the Turnstile form to the URL in that form’s `action`, with all hidden inputs plus `cf-turnstile-response` = token from the solver, then re-requests the login page with the new cookies.
- **Browser flow (Puppeteer):** Does not build a raw HTTP body; it types into the Email/Password inputs and clicks “Sign In”. The real request is whatever the Angular app sends (often a single XHR/fetch to an API). To see the exact request: log in manually with DevTools → Network open, filter by XHR/fetch, and inspect the login request’s URL, method, and payload.

### After login: “Start New Booking” and centre/category/subcategory

- There is **no classic form submit** for choosing centre/category/subcategory. The flow is:
  - Click **Start New Booking**.
  - Select from **mat-form-field** dropdowns (Angular Material): 1) Visa centre, 2) Category, 3) Subcategory.
- Our browser flow (`vfsBrowserFlow.ts`) **clicks** `mat-option` by visible text; it does not send a known API payload. The site may call internal APIs when an option is selected; those are not yet documented in this project.
- To capture the real API calls (dates, times, booking): open the site in the browser, go to DevTools → Network, complete the flow (login → Start New Booking → select centre/category/subcategory → open calendar), and note the URLs and request bodies for availability and booking.

### Summary table

| Step              | What our code sends / does                                                                 | Real site (to confirm in Network) |
|------------------|---------------------------------------------------------------------------------------------|-----------------------------------|
| Cloudflare       | POST form `action` with hidden inputs + `cf-turnstile-response`                             | Same if Turnstile present         |
| Login            | POST to form `action` with email, password, captcha token, `application/x-www-form-urlencoded` | May be Angular API (XHR/fetch)    |
| Centre/category  | Puppeteer: click mat-option by text — no HTTP body in our code                              | Unknown; inspect in DevTools      |
| Dates / times    | Placeholder `fetch` to `/api/availability/dates` and `?date=…` in code                      | Real URLs/params from Network     |
| Book             | Not implemented                                                                             | Real POST from Network            |

## Summary

- **Provider** is chosen per user via the **provider** column (`ais` | `vfsglobal`).
- **Captcha** on VFS login is handled by 2Captcha (env key) or a custom solver.
- **Date cache** is scoped by provider so AIS and VFS do not mix.
- **VFS availability and booking** must be wired to the real VFS API using your browser’s network inspection.
