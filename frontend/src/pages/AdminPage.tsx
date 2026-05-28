import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const API_BASE = "http://localhost:8000";

type Account = {
  id: number;
  username: string;
  displayName: string;
  balance: number;
};

type AccountDraft = {
  username: string;
  displayName: string;
  balance: string;
  password: string;
};

function draftFromAccount(account: Account): AccountDraft {
  return {
    username: account.username,
    displayName: account.displayName,
    balance: String(account.balance),
    password: "",
  };
}

function hasDraftChanges(account: Account, draft: AccountDraft | undefined): boolean {
  if (!draft) return false;
  return (
    draft.username !== account.username ||
    draft.displayName !== account.displayName ||
    draft.balance !== String(account.balance) ||
    draft.password.trim().length > 0
  );
}

export default function AdminPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [drafts, setDrafts] = useState<Record<number, AccountDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [savingAccountId, setSavingAccountId] = useState<number | null>(null);

  const isAdmin = account?.username.toLowerCase() === "admin";
  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.username.localeCompare(b.username)),
    [accounts],
  );

  const loadAdminData = useCallback(async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const meResponse = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
      const meData = await meResponse.json();
      const currentAccount = meData.account ?? null;
      setAccount(currentAccount);

      if (!currentAccount || currentAccount.username.toLowerCase() !== "admin") {
        setAccounts([]);
        setDrafts({});
        return;
      }

      const accountsResponse = await fetch(`${API_BASE}/admin/accounts`, { credentials: "include" });
      const accountsData = await accountsResponse.json();
      if (!accountsResponse.ok) {
        throw new Error(accountsData.detail ?? "Unable to load accounts.");
      }

      const loadedAccounts = accountsData.accounts ?? [];
      setAccounts(loadedAccounts);
      setDrafts(
        Object.fromEntries(
          loadedAccounts.map((loadedAccount: Account) => [loadedAccount.id, draftFromAccount(loadedAccount)]),
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load admin data.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  function updateDraft(accountId: number, changes: Partial<AccountDraft>) {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [accountId]: { ...currentDrafts[accountId], ...changes },
    }));
  }

  function resetDraft(managedAccount: Account) {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [managedAccount.id]: draftFromAccount(managedAccount),
    }));
  }

  async function saveAccount(managedAccount: Account) {
    const draft = drafts[managedAccount.id];
    if (!draft) return;

    const parsedBalance = Number(draft.balance);
    if (!Number.isFinite(parsedBalance) || parsedBalance < 0) {
      setMessage("Money must be a non-negative number.");
      return;
    }

    setSavingAccountId(managedAccount.id);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/admin/accounts/${managedAccount.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: draft.username,
          displayName: draft.displayName,
          balance: Math.floor(parsedBalance),
          password: draft.password.trim() ? draft.password : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail ?? "Unable to save account.");

      const updatedAccount = data.account as Account;
      setAccounts((currentAccounts) =>
        currentAccounts.map((currentAccount) =>
          currentAccount.id === updatedAccount.id ? updatedAccount : currentAccount,
        ),
      );
      setDrafts((currentDrafts) => ({
        ...currentDrafts,
        [updatedAccount.id]: draftFromAccount(updatedAccount),
      }));
      setMessage(`Saved @${updatedAccount.username}.`);
      if (updatedAccount.id === account?.id) setAccount(updatedAccount);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save account.");
    } finally {
      setSavingAccountId(null);
    }
  }

  return (
    <main className="page admin-page">
      <section className="card admin-card">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Admin</p>
            <h1>User Management</h1>
            <p>Every account is listed below. Edit money, username, display name, or set a new password.</p>
          </div>
          <div className="admin-header-actions">
            <button className="secondary-button" disabled={isLoading} onClick={() => void loadAdminData()}>
              Refresh Users
            </button>
            <Link className="secondary-button" to="/">
              Back Home
            </Link>
          </div>
        </div>

        {isLoading && <p>Loading admin data...</p>}
        {!isLoading && !account && <p className="notice">Log in as username admin to manage user accounts.</p>}
        {!isLoading && account && !isAdmin && <p className="notice">Only the admin user can manage accounts.</p>}
        {message && <p className="notice">{message}</p>}

        {!isLoading && isAdmin && accounts.length === 0 && <p className="notice">No user accounts found.</p>}

        {!isLoading && isAdmin && accounts.length > 0 && (
          <div className="admin-table-wrapper">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Username</th>
                  <th>Display name</th>
                  <th>Money</th>
                  <th>New password</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedAccounts.map((managedAccount) => {
                  const draft = drafts[managedAccount.id] ?? draftFromAccount(managedAccount);
                  const isSaving = savingAccountId === managedAccount.id;
                  const isDirty = hasDraftChanges(managedAccount, draft);
                  return (
                    <tr key={managedAccount.id}>
                      <td>#{managedAccount.id}</td>
                      <td>
                        <input
                          aria-label={`Username for account ${managedAccount.id}`}
                          value={draft.username}
                          onChange={(event) => updateDraft(managedAccount.id, { username: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Display name for ${managedAccount.username}`}
                          value={draft.displayName}
                          onChange={(event) => updateDraft(managedAccount.id, { displayName: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Money for ${managedAccount.username}`}
                          min="0"
                          step="1"
                          type="number"
                          value={draft.balance}
                          onChange={(event) => updateDraft(managedAccount.id, { balance: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`New password for ${managedAccount.username}`}
                          placeholder="Leave blank to keep"
                          type="password"
                          value={draft.password}
                          onChange={(event) => updateDraft(managedAccount.id, { password: event.target.value })}
                        />
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          <button disabled={isSaving || !isDirty} onClick={() => void saveAccount(managedAccount)}>
                            {isSaving ? "Saving..." : "Save"}
                          </button>
                          <button className="secondary-button" disabled={isSaving || !isDirty} onClick={() => resetDraft(managedAccount)}>
                            Reset
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
