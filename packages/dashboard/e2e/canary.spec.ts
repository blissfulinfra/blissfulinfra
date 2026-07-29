import { expect, test, type Page } from '@playwright/test'
import { mockApi, PROJECT } from './fixtures/api'

/**
 * Covers the Canary card added in phase 6 (ADR-0020). The card only appears
 * for kubernetes-runtime projects — compose projects get `canary: null` from
 * the API and must not render it.
 */

async function openEnvironments(page: Page) {
  await page.goto('/')
  await page.locator(`[data-testid="project-card"][data-project="${PROJECT}"]`).click()
  await page.getByTestId('tab-nav').getByRole('button', { name: 'Environments' }).click()
}

test.describe('canary rollout card', () => {
  test('renders the rollout status, step counter and traffic split', async ({ page }) => {
    await mockApi(page)
    await openEnvironments(page)

    const card = page.getByTestId('canary-card')
    await expect(card).toBeVisible()
    await expect(card.getByRole('heading', { name: 'Canary Rollout' })).toBeVisible()
    await expect(card).toContainText('Paused')
    await expect(card).toContainText('step 2/4')
    await expect(card).toContainText('40% canary / 60% stable')
    await expect(card).toContainText('Waiting for manual promotion')
  })

  test('is hidden for a project with no Rollout', async ({ page }) => {
    await mockApi(page, { canary: { canary: null } })
    await openEnvironments(page)

    await expect(page.getByRole('row').filter({ hasText: 'staging' })).toBeVisible()
    await expect(page.getByTestId('canary-card')).toHaveCount(0)
  })

  for (const [label, action] of [
    ['Promote', 'promote'],
    ['Promote Full', 'promote-full'],
    ['Abort', 'abort'],
  ] as const) {
    test(`"${label}" posts to the ${action} endpoint`, async ({ page }) => {
      await mockApi(page)
      await openEnvironments(page)

      const posted = page.waitForRequest(
        request =>
          request.method() === 'POST' &&
          new URL(request.url()).pathname.endsWith(`/projects/${PROJECT}/canary/${action}`),
      )
      await page.getByTestId('canary-card').getByRole('button', { name: label, exact: true }).click()
      await posted
    })
  }

  test('surfaces a failed promotion instead of silently swallowing it', async ({ page }) => {
    await mockApi(page)
    await page.route('**/api/v1/projects/*/canary/promote*', route =>
      route.fulfill({ status: 500, json: { error: 'rollout is not paused' } }),
    )
    await openEnvironments(page)

    await page.getByTestId('canary-card').getByRole('button', { name: 'Promote', exact: true }).click()

    await expect(page.getByText('Canary Action Failed')).toBeVisible()
    await expect(page.getByText('rollout is not paused')).toBeVisible()
  })

  test('disables the actions once the rollout is fully healthy', async ({ page }) => {
    await mockApi(page, {
      canary: { canary: { status: 'Healthy', step: 4, totalSteps: 4, currentWeight: 100 } },
    })
    await openEnvironments(page)

    const card = page.getByTestId('canary-card')
    await expect(card.getByRole('button', { name: 'Promote', exact: true })).toBeDisabled()
    await expect(card.getByRole('button', { name: 'Promote Full' })).toBeDisabled()
    await expect(card.getByRole('button', { name: 'Abort' })).toBeDisabled()
  })
})
