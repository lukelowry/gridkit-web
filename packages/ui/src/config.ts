/** What a deployment tells the UI, in config.json beside it. Its services are beside it, each at api/<name>/, unless named. */
export interface Config {
  /** GridKit's module, relative to the UI: studies run in the page. Without it, they run on the solver service. */
  readonly gridkit?: string;
  /** Where the library is, relative to the UI or a full address. Without it, the library is beside the UI. */
  readonly library?: string;
}
