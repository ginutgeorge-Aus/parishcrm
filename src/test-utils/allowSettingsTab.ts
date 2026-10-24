/**
 * Makes a mocked `requireSettingsTab` let the guard pass and run the page's
 * load, as the real guard does (`data` is `null` without a load).
 * @param mock the `jest.fn()` standing in for `requireSettingsTab`
 * @param features enabled features to report
 */
export function allowSettingsTab(mock: jest.Mock, features: Set<string>): void {
  mock.mockImplementation(async (_href: string, load?: () => Promise<unknown>) => ({ features, data: load ? await load() : null }))
}
