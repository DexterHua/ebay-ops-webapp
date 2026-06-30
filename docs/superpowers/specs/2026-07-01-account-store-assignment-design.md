# Account Store Assignment Design

## Goal

Add store assignment to account creation so each user can be granted access to specific stores at the moment the account is created. Assigned stores appear as store buttons in the top header and link to the single-store operations dashboard. Stores not assigned to the current user are hidden from the header and cannot be accessed by manually entering `/store/[id]`.

## Scope

- Extend account data with assigned store IDs.
- Add store selection controls to the add-account dialog.
- Show assigned stores in the account list.
- Return assigned stores from the current-user API.
- Filter header store buttons by the current user's assigned stores.
- Enforce store access on the single-store dashboard route.

Existing accounts without store assignment data remain compatible by receiving access to all active stores. This avoids unexpectedly locking historical users out after deployment.

## Data Model

`User` gains an optional `storeIds` field containing store IDs from the global `STORES` config, for example:

```ts
storeIds?: StoreId[];
```

New users created through account management store only valid active store IDs. Invalid store IDs are rejected. Empty assignment is allowed and means the user has no store-dashboard access.

Historical users with `storeIds === undefined` resolve to all active stores. Users with `storeIds: []` resolve to no stores.

## Server Behavior

`addUser` accepts store IDs in addition to name, password, and role. It validates roles and store IDs before writing. Recreating a previously deleted user replaces the old store assignment with the new one while incrementing the session version as today.

`listUsers` returns normalized `storeIds` so account management can display assigned stores without exposing passwords.

`requireSession` returns the current user's normalized `storeIds`. `/api/auth/me` includes the same field for client UI filtering.

The single-store dashboard checks the current session before rendering. If the requested store ID is not assigned, it returns a no-permission state instead of rendering dashboard data. This blocks manual URL access as well as hidden navigation links.

## UI Behavior

The add-account dialog includes a "店铺分配" section with checkboxes for active stores. Store labels reuse `STORES` names so the UI stays aligned with the dashboard links.

After creation, the dialog resets the selected stores to an empty list. The account list shows assigned store names; historical all-store accounts show all active store names through the normalized API response.

The header fetches `/api/auth/me` and filters `STORES.filter(active)` to only IDs returned by the API. If the user has no assigned stores, the header store group renders no store buttons.

## Testing

Add tests for:

- Validating supported store IDs and rejecting invalid store assignment input.
- Creating users with assigned store IDs.
- Listing users with normalized store IDs, including historical users.
- Returning store IDs from session/current-user behavior.
- Rejecting access to an unassigned `/store/[id]` dashboard route.
