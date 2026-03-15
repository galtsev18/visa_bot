const url = 'https://visa.vfsglobal.com/kaz/en/usa/login';
const opts = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0' } };

fetch(url, opts)
  .then((r) => r.text())
  .then((d) => {
    const formMatch = d.match(/<form[^>]*action=["']([^"']*)["'][^>]*>/i) || d.match(/<form[^>]*>/i);
    const inputs = d.match(/<input[^>]+>/gi) || [];
    const buttons = d.match(/<button[^>]*>[\s\S]*?<\/button>/gi) || [];
    console.log('=== FORM ===');
    console.log('Form tag:', formMatch ? formMatch[0].slice(0, 200) : 'no form');
    console.log('\n=== INPUTS (name, type) ===');
    inputs.forEach((i) => {
      const name = (i.match(/name=["']([^"']*)["']/i) || [])[1];
      const type = (i.match(/type=["']([^"']*)["']/i) || [])[1];
      console.log('  ', name || '(no name)', type || '');
    });
    console.log('\n=== Buttons ===');
    buttons.slice(0, 5).forEach((b) => console.log('  ', b.replace(/\s+/g, ' ').slice(0, 120)));
    if (d.includes('cf-turnstile')) console.log('\nCloudflare Turnstile: yes');
    if (d.includes('g-recaptcha')) console.log('reCAPTCHA: yes');
  })
  .catch((e) => console.error(e));
