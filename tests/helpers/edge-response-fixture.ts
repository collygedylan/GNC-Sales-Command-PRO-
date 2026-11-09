export type EdgeFixtureAction<Call> = NonNullable<Parameters<Promise<Call[]>["then"]>[0]>;

export function versionedEdgeBody(response: Response, body: object) {
  const version = response.headers.get("x-agdata-app-version");
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Expected the deployed app version header.");
  return { ...body, app_version: version };
}
