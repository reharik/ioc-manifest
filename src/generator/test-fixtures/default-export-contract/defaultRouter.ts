/** Mimics @types packages that expose the contract only as `export default class Router`. */
export default class Router {
  use = (): this => this;
}
