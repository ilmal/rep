import { test, expect, seed, makeSession, makeAreas } from './fixtures';
test('seeded app boots on Today without onboarding', async ({ page, errors }) => {
  const a = makeAreas();
  await seed(page, { sessions: [makeSession({ id: 's1', seq: 1, slot: 1, areaId: a[0].id, areaName: a[0].name, daysAgo: 0.2, exerciseIds: ['bench_press', 'seated_row'] })] });
  await page.goto('');
  await expect(page.getByText(/Hi Alex/i)).toBeVisible();
  await expect(page.getByText('1/4').first()).toBeVisible();
  expect(errors).toEqual([]);
});
