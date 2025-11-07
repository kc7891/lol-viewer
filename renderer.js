document.addEventListener('DOMContentLoaded', () => {
  const championInput = document.getElementById('championName');
  const openButton = document.getElementById('openButton');

  function openChampionBuild() {
    const championName = championInput.value.trim().toLowerCase();

    if (!championName) {
      alert('チャンピオン名を入力してください');
      return;
    }

    // Build the LoLAnalytics URL
    const url = `https://lolalytics.com/lol/${championName}/build/`;

    // Open in external browser
    window.electronAPI.openExternal(url);

    // Clear input for next use
    championInput.value = '';
    championInput.focus();
  }

  // Handle button click
  openButton.addEventListener('click', openChampionBuild);

  // Handle Enter key press
  championInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      openChampionBuild();
    }
  });
});
