import { expect, test, type Page } from '@playwright/test'
import { mockApi, PROJECT } from './fixtures/api'

async function selectProject(page: Page, name = PROJECT) {
  await page.goto('/')
  await page.locator(`[data-testid="project-card"][data-project="${name}"]`).click()
  await expect(page.getByTestId('project-detail')).toBeVisible()
}

test.describe('project detail', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page)
  })

  test('shows the project stack and lifecycle buttons', async ({ page }) => {
    await selectProject(page)

    const detail = page.getByTestId('project-detail')
    await expect(detail).toContainText('running')
    await expect(detail).toContainText('fullstack')
    await expect(detail).toContainText('spring-boot')
    await expect(detail).toContainText('postgres')

    await expect(detail.getByRole('button', { name: 'Start' })).toBeDisabled()
    await expect(detail.getByRole('button', { name: 'Stop' })).toBeEnabled()
  })

  test('renders live service health, not the stale registry status', async ({ page }) => {
    await selectProject(page)

    const health = page.getByTestId('service-connections')
    await expect(health).toContainText('api')
    await expect(health).toContainText('12ms')
    await expect(health).toContainText('web')
    await expect(health).toContainText('connection refused')
    await expect(health.getByRole('link', { name: ':8090' })).toHaveAttribute('href', 'http://localhost:8090')
  })

  test('inverts the lifecycle buttons for a stopped project', async ({ page }) => {
    await selectProject(page, 'billing')

    const detail = page.getByTestId('project-detail')
    await expect(detail.getByRole('button', { name: 'Start' })).toBeEnabled()
    await expect(detail.getByRole('button', { name: 'Stop' })).toBeDisabled()
  })

  test('opens on the logs tab and streams log lines', async ({ page }) => {
    await selectProject(page)

    await expect(page.getByText('Started ApiApplication in 3.1s')).toBeVisible()
  })

  test('switches to the environments tab and renders the ArgoCD sync table', async ({ page }) => {
    await selectProject(page)
    await page.getByTestId('tab-nav').getByRole('button', { name: 'Environments' }).click()

    const row = page.getByRole('row').filter({ hasText: 'production' }).first()
    await expect(row).toContainText('9f8e7d6')
    await expect(row).toContainText('OutOfSync')
    await expect(row).toContainText('1/3')
    await expect(row.getByRole('button', { name: 'Deploy' })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Rollback' })).toBeVisible()
  })

  test('deploying an environment posts to the deploy endpoint', async ({ page }) => {
    await selectProject(page)
    await page.getByTestId('tab-nav').getByRole('button', { name: 'Environments' }).click()

    const deployed = page.waitForRequest(
      request => request.method() === 'POST' && /\/projects\/[^/]+\/deploy$/.test(new URL(request.url()).pathname),
    )
    await page.getByRole('row').filter({ hasText: 'staging' }).first().getByRole('button', { name: 'Deploy' }).click()
    expect((await deployed).postDataJSON()).toMatchObject({ env: 'staging' })
  })
})
