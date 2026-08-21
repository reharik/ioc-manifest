export type InitialGraphQLContext = {
  readonly requestId: string;
};

export type GraphQLContext = InitialGraphQLContext & {
  readonly viewerId: string;
};
