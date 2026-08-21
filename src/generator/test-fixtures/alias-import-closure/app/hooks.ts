export type AppContext = {
  readonly requestId: string;
};

/** Generic alias over a FUNCTION type — instantiating it yields no `ts.TypeReference`. */
export type Hook<TContext> = (context: TContext) => void;
