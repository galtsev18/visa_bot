declare module 'puppeteer-extra' {
  import { Browser } from 'puppeteer';
  interface PuppeteerExtra {
    use(plugin: unknown): PuppeteerExtra;
    launch(options?: object): Promise<Browser>;
    default: PuppeteerExtra;
  }
  const puppeteer: PuppeteerExtra;
  export default puppeteer;
}

declare module 'puppeteer-extra-plugin-stealth' {
  function defaultExport(): unknown;
  export default defaultExport;
}
