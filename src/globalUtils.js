window.getAccountId = () => {
  const accountId = window.location.hostname
    .split(".")[0]
    .replace(/-/g, "_")
    .toUpperCase();
  return accountId;
};
