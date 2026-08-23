export type AnalyticsAudience = "prod" | "dev";

export function audienceView<Prod extends string, Dev extends string>(
  audience: AnalyticsAudience,
  prod: Prod,
  dev: Dev,
): Prod | Dev {
  return audience === "dev" ? dev : prod;
}
