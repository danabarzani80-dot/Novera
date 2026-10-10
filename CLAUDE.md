# Business ERP: project guide

A CRM + ERP platform built with Laravel 13, Filament 5 (Livewire 4) and MySQL 8.4. Read `docs/ARCHITECTURE.md` before changing anything structural. It holds the schema plan, posting rules and phase order.

## Local environment (Windows, Laragon)

- PHP: `C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe` (not on PATH by default)
- Composer: `php C:/laragon/bin/composer/composer.phar`
- Node: `C:/laragon/bin/nodejs/node-v22`
- MySQL 8.4 at 127.0.0.1:3306, user `root`, no password. Databases are `erp` (app) and `erp_testing` (tests).
- Run: `php artisan serve`, then open http://127.0.0.1:8000/admin
- Rebuild the theme after changing classes or CSS: `npm run build`
- Demo data (development only, refuses production): `php artisan db:seed --class=DemoDataSeeder`, which loads business units, approved budgets and projects so the dashboard has content.
- Tests: `php artisan test`. They run against MySQL, not SQLite, so locks, triggers and constraints behave as in production.
- Format: `vendor/bin/pint`

## Rules that must not be broken

1. **Business logic lives in `app/Actions` and `app/Services`**, never in Filament pages. Pages call an Action and wrap it in `HandlesBusinessRules::guardBusinessRules()`.
2. **Every multi-step write runs in one `DB::transaction()`.** Lock the rows you depend on (`lockForUpdate`).
3. **Company isolation.** Company-owned models use the `BelongsToCompany` trait and have `company_id`. Policies extend `ModulePolicy`, which also checks record ownership. Resources whose model is not owned directly (for example users) must scope `getEloquentQuery()` explicitly.
4. **Permissions** are declared only in `config/erp_permissions.php` (`module.ability`). After editing, run `php artisan erp:sync-permissions`. Roles are assigned per company (spatie teams, `company_id`).
5. **Audit.** Models use the `Auditable` trait. Use `AuditLogger::withReason()` for corrections and cancellations. `audit_logs` is append-only (DB triggers).
6. **Numbers** come from `DocumentNumberService::next()`, called inside the transaction that saves the document.
7. **Posted documents are immutable.** Corrections are new reversing documents, never edits or deletes.
8. **User-facing errors** are thrown as `BusinessRuleException` with a plain-language message. Never show raw SQL errors.
9. Lazy loading throws outside production. Eager-load relationships.
10. Keep model `$attributes` defaults in sync with column defaults (for example `is_active`). Otherwise freshly created models misbehave until reloaded.

## Tests

`tests/TestCase.php` has helpers: `seedFoundation()`, `createCompany()`, `memberOf($company, $roles)`, `roleWith($company, $permissions)` and `actingInCompany($user, $company)`, which boots the panel so tenant scopes apply as they do in real requests.
