import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { demoPassword } from './fixtures.js';

async function login(page: Page, role = 'asesor') {
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(`${role}@demo.test`);
  await page.getByLabel('Contraseña').fill(demoPassword);
  await page.getByRole('button', { name: /Ingresar al espacio/ }).click();
  await expect(page.getByRole('heading', { name: 'Solicitudes de crédito' })).toBeVisible();
}
test('desktop: real login → create → two independent offers → accept → persisted audit', async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole('button', { name: /Nueva solicitud/ })
    .first()
    .click();
  await page.getByLabel('Nombre completo').fill('Cliente E2E Ficticio');
  await page.getByRole('checkbox', { name: /Registro el consentimiento/ }).check();
  await page.getByRole('button', { name: /Registrar y enviar/ }).click();
  await expect(page.getByRole('heading', { name: 'Cliente E2E Ficticio' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aceptar esta oferta' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Aceptar esta oferta' }).first().click();
  await expect(page.getByText('Oferta aceptada', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '✓ Oferta seleccionada' })).toBeDisabled();
  await expect(page.locator('.timeline')).toContainText('Oferta seleccionada');
  await expect(
    page.getByText('Comunicación con la financiera: completada', { exact: true }),
  ).toHaveCount(2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await mkdir('artifacts/e2e', { recursive: true });
  await page.screenshot({ path: 'artifacts/e2e/desktop-accepted.png', fullPage: true });
  await page.getByRole('button', { name: '← Volver a solicitudes' }).click();
  await page.getByRole('button', { name: 'Ver solicitud de Cliente E2E Ficticio' }).click();
  await expect(page.getByRole('button', { name: '✓ Oferta seleccionada' })).toBeDisabled();
});
test('mobile: form fits viewport and supervisor cannot create via API', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page
    .getByRole('button', { name: /Nueva solicitud/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Nueva solicitud' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mkdir('artifacts/e2e', { recursive: true });
  await page.screenshot({ path: 'artifacts/e2e/mobile-form.png', fullPage: true });
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await login(page, 'supervisor');
  await expect(page.getByRole('button', { name: /Nueva solicitud/ })).toHaveCount(0);
  const auth = await page.request.post('/v1/auth/login', {
    data: { email: 'supervisor@demo.test', password: demoPassword },
  });
  expect(auth.status()).toBe(200);
  const { token } = await auth.json();
  const denied = await page.request.post('/v1/solicitudes', {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    data: {
      client: {
        name: 'Cliente Solo Consulta',
        email: 'readonly@example.test',
        identification: 'DEMO-000999',
        incomeCents: 250000,
      },
      vehicle: { brand: 'Demo', model: 'Prueba', year: 2026, priceCents: 3000000 },
      financing: { downPaymentCents: 900000, termMonths: 48 },
      consent: {
        accepted: true,
        channel: 'web',
        evidence: 'Consentimiento ficticio de pruebas académicas',
      },
      banks: ['pichincha'],
      scenario: 'aprobada',
    },
  });
  expect(denied.status()).toBe(403);
});
