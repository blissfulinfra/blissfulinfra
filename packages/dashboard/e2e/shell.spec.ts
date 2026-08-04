import { expect, test } from '@playwright/test'
import { defaultFixtures, mockApi, PROJECT, TENANT } from './fixtures/api'

test.describe('dashboard shell', () => {
  test('renders the header, the tenant badge and the tool links', async ({ page }) => {
    await mockApi(page)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'blissful-infra' })).toBeVisible()
    await expect(page.getByText(TENANT, { exact: true }).first()).toBeVisible()

    await expect(page.getByRole('link', { name: 'Grafana' })).toHaveAttribute('href', 'http://localhost:3100')
    await expect(page.getByRole('link', { name: 'ArgoCD' })).toHaveAttribute('href', 'http://localhost:8081')
    await expect(page.getByRole('link', { name: 'Gitea' })).toHaveAttribute('href', 'http://localhost:3000')
  })

  test('lists the tenant projects in the sidebar', async ({ page }) => {
    await mockApi(page)
    await page.goto('/')

    const sidebar = page.getByTestId('sidebar')
    await expect(sidebar.getByRole('heading', { name: /Projects \(2\)/ })).toBeVisible()
    await expect(page.getByTestId('project-card')).toHaveCount(2)
    await expect(sidebar.getByTestId('project-card').first()).toContainText('checkout')
    await expect(sidebar.getByTestId('project-card').nth(1)).toContainText('billing')
  })

  test('shows an empty state when the tenant has no projects', async ({ page }) => {
    await mockApi(page, { projects: { projects: [] } })
    await page.goto('/')

    await expect(page.getByText('No projects in this tenant yet')).toBeVisible()
    await expect(page.getByTestId('project-card')).toHaveCount(0)
  })

  test('survives an API server that is not running', async ({ page }) => {
    await page.route('**/api/v1/**', route => route.abort('connectionrefused'))
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'blissful-infra' })).toBeVisible()
    await expect(page.getByText('No projects in this tenant yet')).toBeVisible()
  })

  // The first /projects fetch fires before /tenants resolves and carries no
  // tenant param — the server falls through to the env-pinned tenant. What
  // matters is that no fetch is ever scoped to a tenant the user did not pick.
  test('scopes project fetches to the selected tenant', async ({ page }) => {
    const requested: string[] = []
    page.on('request', request => {
      if (request.url().includes('/api/v1/projects')) requested.push(request.url())
    })

    await mockApi(page)
    const scoped = page.waitForRequest(request => request.url().includes(`tenant=${TENANT}`))
    await page.goto('/')
    await scoped
    await expect(page.getByTestId('project-card').first()).toBeVisible()

    const misrouted = requested.filter(url => /tenant=(?!acme\b)/.test(url))
    expect(misrouted).toEqual([])
  })

  test('switching tenants re-scopes the project list', async ({ page }) => {
    await mockApi(page)
    await page.goto('/')
    await expect(page.getByTestId('project-card').first()).toBeVisible()

    const switcher = page.locator('select[title="Switch tenant"]')
    await expect(switcher).toHaveValue(TENANT)

    const refetch = page.waitForRequest(url => url.url().includes('tenant=globex'))
    await switcher.selectOption('globex')
    await refetch

    // The first project of the newly-selected tenant is auto-selected so the
    // detail view is never empty.
    await expect(page.getByTestId('project-detail')).toBeVisible()
    await expect(page.getByTestId('project-detail')).toContainText(PROJECT)
  })

  test('renders the tenant overview when the tenant card is clicked', async ({ page }) => {
    await mockApi(page)
    await page.goto('/')

    await page.getByRole('button', { name: /Tenant overview/ }).click()

    for (const infra of (defaultFixtures.clientInfra as { infra: Array<{ label: string }> }).infra) {
      await expect(page.getByText(infra.label).first()).toBeVisible()
    }
  })
})
