// background.js

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Sniff CSV files
/* chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!downloadItem.finalUrl.includes(".csv")) return;
  console.log("Download detected, cancelling:", downloadItem.filename);
  console.log(downloadItem);

  chrome.downloads.cancel(downloadItem.id);

  fetch(downloadItem.finalUrl)
    .then((response) => response.text())
    .then((csv) => {
      console.log(csv);
    });
}); */
