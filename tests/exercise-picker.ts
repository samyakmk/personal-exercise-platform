import type { Locator, Page } from '@playwright/test';

export async function chooseExercise(scope: Locator | Page, label: string, name: string) {
  await scope.getByRole('combobox', { name: label, exact: true }).fill(name);
  await scope.getByRole('listbox', { name: label, exact: true })
    .getByRole('option', { name: new RegExp(`^${name}(?: · .+)?$`) }).click();
}
