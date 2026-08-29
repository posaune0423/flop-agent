export async function makeTestDir(): Promise<string> {
  const root = `${Deno.cwd()}/.test-tmp`;
  await Deno.mkdir(root, { recursive: true, mode: 0o700 });
  return await Deno.makeTempDir({ dir: root });
}
