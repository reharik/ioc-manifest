/** Mimics `export =` style modules (e.g. some CommonJS typings). */
class Router {
  use = (): this => this;
}
export = Router;
