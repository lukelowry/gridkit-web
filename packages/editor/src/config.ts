/** What a deployment tells the editor, in config.json beside it. Its services are beside it too, each at api/<name>/. */
export interface Config {
  /** GridKit's module, relative to the editor: studies run in the page. Without it, they run on the solver service. */
  readonly gridkit?: string;
}
