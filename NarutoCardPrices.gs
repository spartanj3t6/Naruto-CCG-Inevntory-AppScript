function getCardPrice(cardName, setName) {
  if (!cardName || cardName.toString().trim() === "") return "";

  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();
  const cacheVersion = props.getProperty("cacheVersion") || "1";
  const cacheKey = "v" + cacheVersion + "_price_" + cardName.toString().trim().substring(0, 220) + (setName ? "_" + setName.trim().substring(0, 50) : "");
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const options = {
    "headers": {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    "muteHttpExceptions": true
  };

  const normalize = str => str.toLowerCase().replace(/\s*-\s*/g, "-").replace(/["\u201C\u201D\u201E\u201F]/g, "");
  const normalizeSet = str => str ? str.toLowerCase().trim() : "";

  function decodeEntities(str) {
    return str
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&apos;/g, "'");
  }

  function normalizeApostrophes(str) {
    return str
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
  }

  function stripEdition(name) {
    return name.replace(/\s*Edition/gi, "").replace(/\s{2,}/g, " ").trim();
  }

  function getEditionVariants(name) {
    const variants = [name];
    if (/1st Edition/i.test(name)) {
      variants.push(name.replace(/1st Edition/gi, "First Edition"));
    }
    if (/First Edition/i.test(name)) {
      variants.push(name.replace(/First Edition/gi, "1st Edition"));
    }
    if (/edition/i.test(name)) {
      variants.push(stripEdition(name));
    }
    return variants;
  }

  const cleanName = normalizeApostrophes(
    cardName.toString()
      .replace(/ - Gold Letters/gi, "").replace(/Gold Letters - /gi, "")
      .replace(/ - Red Letters/gi, "").replace(/Red Letters - /gi, "")
      .replace(/ - Rainbow Letters/gi, "").replace(/Rainbow Letters - /gi, "")
      .trim()
  );

  function fetchPage(name, page) {
  const searchName = name.replace(/["\u201C\u201D]/g, "");
  const url = "https://goatcardsshop.crystalcommerce.com/products/search?q=%22" + encodeURIComponent(searchName) + "%22&page=" + page;
  return UrlFetchApp.fetch(url, options).getContentText();
  }

  function findPriceInHtml(html, name, targetSet) {
      const conditionPriority = ["NM/LP", "Played", "Damaged"];

      const formRegex = /data-name="((?:&quot;|[^"])+)"[^>]*data-price="(\$[\d.]+)"[^>]*data-category="([^"]+)"[^>]*data-variant="([^"]+)"/gi;
      let match;
      const found = {};

      while ((match = formRegex.exec(html)) !== null) {
        const siteName = normalizeApostrophes(decodeEntities(match[1].trim()));
        const price = match[2];
        const category = normalizeApostrophes(decodeEntities(match[3].trim()));
        const variant = match[4].trim();

        if (normalize(siteName) === normalize(name)) {
          if (!targetSet || normalizeSet(category) === normalizeSet(targetSet)) {
            if (!found[variant]) found[variant] = price;
          }
        }
      }

      for (const condition of conditionPriority) {
        if (found[condition]) return found[condition];
      }

      const productBlockRegex = /itemprop="name"[^>]*title="([^"]+)"/gi;
      let blockMatch;

      while ((blockMatch = productBlockRegex.exec(html)) !== null) {
        const blockName = normalizeApostrophes(decodeEntities(blockMatch[1].trim()));

        if (normalize(blockName) !== normalize(name)) continue;

        const htmlAfter = html.substring(blockMatch.index);

        const categoryMatch = htmlAfter.match(/<span[^>]*class="category"[^>]*>([^<]+)<\/span>/i);
        const blockCategory = categoryMatch ? normalizeApostrophes(decodeEntities(categoryMatch[1].trim())) : "";

        if (targetSet && normalizeSet(blockCategory) !== normalizeSet(targetSet)) continue;

        const noStockMatch = htmlAfter.match(/<span[^>]*class="price no-stock"[^>]*>\s*\$?([\d.]+)/i);
        if (noStockMatch) return "$" + noStockMatch[1];
      }

      // --- Last resort: match by h4 text content for cards with quotes in name ---
      const h4Regex = /<h4[^>]*itemprop="name"[^>]*>(.*?)<\/h4>/gi;
      let h4Match;
      while ((h4Match = h4Regex.exec(html)) !== null) {
        const h4Name = normalizeApostrophes(decodeEntities(h4Match[1].trim()));
        if (normalize(h4Name) !== normalize(name)) continue;

        const htmlAfter = html.substring(h4Match.index);

        const categoryMatch = htmlAfter.match(/<span[^>]*class="category"[^>]*>([^<]+)<\/span>/i);
        const blockCategory = categoryMatch ? normalizeApostrophes(decodeEntities(categoryMatch[1].trim())) : "";
        if (targetSet && normalizeSet(blockCategory) !== normalizeSet(targetSet)) continue;

        const htmlChunk = html.substring(h4Match.index, h4Match.index + 3000);
        const nearbyFormRegex = /data-price="(\$[\d.]+)"[^>]*data-variant="([^"]+)"/gi;
        const nearbyFound = {};
        let nfMatch;
        while ((nfMatch = nearbyFormRegex.exec(htmlChunk)) !== null) {
          const variant = nfMatch[2].trim();
          if (!nearbyFound[variant]) nearbyFound[variant] = nfMatch[1];
        }
        for (const condition of conditionPriority) {
          if (nearbyFound[condition]) return nearbyFound[condition];
        }

        const noStockMatch = htmlAfter.match(/<span[^>]*class="price no-stock"[^>]*>\s*\$?([\d.]+)/i);
        if (noStockMatch) return "$" + noStockMatch[1];
      }

      return null;
  }

  function searchForPrice(name, targetSet) {
    const isZeroPrice = price => price === "$0.00" || price === "$0";

    const html1 = fetchPage(name, 1);
    const price1 = findPriceInHtml(html1, name, targetSet);
    if (price1 && !isZeroPrice(price1)) return price1;
    if (price1 && isZeroPrice(price1)) return "$0 - Verify";

    if (html1.includes("data-name=") || html1.includes('class="price no-stock"')) {
      try {
        const html2 = fetchPage(name, 2);
        const price2 = findPriceInHtml(html2, name, targetSet);
        if (price2 && !isZeroPrice(price2)) return price2;
        if (price2 && isZeroPrice(price2)) return "$0 - Verify";
      } catch(e) {}
    }

    return null;
  }

  function stripFoil(name) {
    return name.replace(/\s*-\s*Foil/gi, "").trim();
  }

  function buildRarityFallback(name) {
    const parts = name.split(" - ");
    if (parts.length >= 3) {
      const rarity = parts[2];
      return parts[0] + " - " + rarity + " - " + parts.slice(1).join(" - ");
    }
    return null;
  }

  function searchWithEditionFallback(name, targetSet) {
    const variants = getEditionVariants(name);
    for (const variant of variants) {
      const price = searchForPrice(variant, targetSet);
      if (price) return price;
    }
    return null;
  }

  const targetSet = setName ? setName.toString().trim() : null;
  const isSuperRare = cleanName.includes("Super Rare");
  const isStarterSuperRare = cleanName.includes("Super Rare (Starter)");
  const hasFoil = /foil/i.test(cleanName);

  try {
    // --- Super Rare (Starter) path ---
    if (isStarterSuperRare) {
      const asPlainSuperRare = cleanName.replace(/Super Rare \(Starter\)/gi, "Super Rare");
      const asStarter = cleanName.replace(/Super Rare \(Starter\)/gi, "Starter");

      let price = searchWithEditionFallback(asPlainSuperRare, targetSet);
      if (price) { cache.put(cacheKey, price, 21600); return price; }

      if (hasFoil) {
        const asPlainSuperRareNoFoil = stripFoil(asPlainSuperRare);
        price = searchWithEditionFallback(asPlainSuperRareNoFoil, targetSet);
        if (price) { cache.put(cacheKey, price, 21600); return price; }
      }

      price = searchWithEditionFallback(asStarter, targetSet);
      if (price) { cache.put(cacheKey, price, 21600); return price; }

      if (hasFoil) {
        const asStarterNoFoil = stripFoil(asStarter);
        price = searchWithEditionFallback(asStarterNoFoil, targetSet);
        if (price) { cache.put(cacheKey, price, 21600); return price; }
      }

      price = searchWithEditionFallback(cleanName, targetSet);
      if (price) { cache.put(cacheKey, price, 21600); return price; }

      if (hasFoil) {
        const noFoil = stripFoil(cleanName);
        price = searchWithEditionFallback(noFoil, targetSet);
        if (price) { cache.put(cacheKey, price, 21600); return price; }
      }

      return "Not found";
    }

    // --- Regular Super Rare with foil path ---
    if (isSuperRare && hasFoil) {
      let price = searchWithEditionFallback(cleanName, targetSet);
      if (price) { cache.put(cacheKey, price, 21600); return price; }

      const noFoil = stripFoil(cleanName);
      price = searchWithEditionFallback(noFoil, targetSet);
      if (price) { cache.put(cacheKey, price, 21600); return price; }

      return "Not found";
    }

    // --- Standard path ---

    // --- Invasion fallback: try without rarity in the key (run first for Invasion set) ---
    if (targetSet && targetSet.toLowerCase() === "invasion") {
      const invasionParts = cleanName.split(" - ");
      if (invasionParts.length >= 3) {
        const invasionName = invasionParts[0] + " - " + invasionParts[1] + " -  - " + invasionParts.slice(3).join(" - ");
        let price = searchWithEditionFallback(invasionName, targetSet);
        if (price) { cache.put(cacheKey, price, 21600); return price; }
      }
    }

    let price = searchWithEditionFallback(cleanName, targetSet);
    if (price) { cache.put(cacheKey, price, 21600); return price; }

    // Try stripping double quotes from name
    const noQuotes = cleanName.replace(/["\u201C\u201D]/g, '');
    if (noQuotes !== cleanName) {
      price = searchWithEditionFallback(noQuotes, targetSet);
      if (price) { cache.put(cacheKey, price, 21600); return price; }
    }

    const rarityFallback = buildRarityFallback(cleanName);
    if (rarityFallback) {
      price = searchWithEditionFallback(rarityFallback, targetSet);
      if (price) { cache.put(cacheKey, price, 21600); return price; }
    }

    const parts = cleanName.split(" - ");
    if (parts.length >= 3) {
      const rarity = parts[2];
      for (const suffix of [" A", " B"]) {
        const withSuffix = parts[0] + " - " + rarity + suffix + " - " + parts.slice(1).join(" - ");
        price = searchWithEditionFallback(withSuffix, targetSet);
        if (price) { cache.put(cacheKey, price, 21600); return price; }
      }
    }

    if (cleanName.toLowerCase().includes("starter deck")) {
      const noEdition = cleanName.replace(/ - Unlimited Edition/gi, "").trim();
      price = searchWithEditionFallback(noEdition, targetSet);
      if (price) { cache.put(cacheKey, price, 21600); return price; }

      const neRarityFallback = buildRarityFallback(noEdition);
      if (neRarityFallback) {
        price = searchWithEditionFallback(neRarityFallback, targetSet);
        if (price) { cache.put(cacheKey, price, 21600); return price; }
      }

      const starterParts = cleanName.split(" - ");
      if (starterParts.length >= 3) {
        const starterName = starterParts.map((part, idx) => idx === 2 ? "Starter" : part).join(" - ");
        price = searchWithEditionFallback(starterName, targetSet);
        if (price) { cache.put(cacheKey, price, 21600); return price; }

        const starterNoEdition = starterName.replace(/ - Unlimited Edition/gi, "").trim();
        price = searchWithEditionFallback(starterNoEdition, targetSet);
        if (price) { cache.put(cacheKey, price, 21600); return price; }

        // NEW: try "Starter Deck" as rarity label explicitly
        const starterDeckName = starterParts.map((part, idx) => idx === 2 ? "Starter Deck" : part).join(" - ");
        price = searchWithEditionFallback(starterDeckName, targetSet);
        if (price) { cache.put(cacheKey, price, 21600); return price; }

        const starterDeckNoEdition = starterDeckName.replace(/ - Unlimited Edition/gi, "").trim();
        price = searchWithEditionFallback(starterDeckNoEdition, targetSet);
        if (price) { cache.put(cacheKey, price, 21600); return price; }
      }
    }

    const reprintParts = cleanName.split(" - ");
    if (reprintParts.length >= 3) {
      const reprintName = reprintParts[0] + " - " + reprintParts[1] + " - Reprint - First Edition";
      price = searchWithEditionFallback(reprintName, targetSet);
      if (price) { cache.put(cacheKey, price, 21600); return price; }
    }

    return "Not found";
  } catch(e) {
    return "Error: " + e.message;
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Card Prices")
    .addItem("Update All Prices", "updateAllPrices")
    .addItem("Refresh All Prices", "refreshAllPrices")
    .addItem("Update Selected Rows", "updateSelectedRows")
    .addItem("Update Selected Row", "updateSelectedRow")
    .addSeparator()
    .addItem("Clear Price Cache", "clearCache")
    .addToUi();
}

function clearCache() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    "Clear Price Cache",
    "This will clear all cached prices so everything is re-fetched fresh. Continue?",
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  const props = PropertiesService.getScriptProperties();
  const currentVersion = parseInt(props.getProperty("cacheVersion") || "1");
  props.setProperty("cacheVersion", (currentVersion + 1).toString());

  ui.alert("Done!", "Price cache cleared. Prices will be re-fetched on next update.", ui.ButtonSet.OK);
}

function updateAllPrices() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const sheetName = sheet.getName();
  const props = PropertiesService.getScriptProperties();
  const lastRow = sheet.getLastRow();
  const ui = SpreadsheetApp.getUi();

  const resumeKey = "resumeRow_" + sheetName;
  let startRow = parseInt(props.getProperty(resumeKey) || "2");

  if (startRow > 2) {
    const resume = ui.alert(
      "Resume?",
      `A previous run on "${sheetName}" stopped at row ${startRow}. Resume from there?`,
      ui.ButtonSet.YES_NO
    );
    if (resume === ui.Button.NO) startRow = 2;
  } else {
    const response = ui.alert(
      "Update All Prices",
      `This will fetch missing/failed prices on "${sheetName}". Continue?`,
      ui.ButtonSet.YES_NO
    );
    if (response !== ui.Button.YES) return;
  }

  const startTime = Date.now();
  const TIME_LIMIT = 5 * 60 * 1000;
  let fetchCount = 0;
  const FETCH_LIMIT = 150;

  for (let row = startRow; row <= lastRow; row++) {
    if (Date.now() - startTime > TIME_LIMIT) {
      props.setProperty(resumeKey, row.toString());
      ui.alert("Paused", `Time limit reached on "${sheetName}". Progress saved at row ${row}.\n\nRun "Update All Prices" again to continue.`, ui.ButtonSet.OK);
      return;
    }

    if (fetchCount >= FETCH_LIMIT) {
      props.setProperty(resumeKey, row.toString());
      ui.alert("Paused — Fetch Limit Reached", `Reached ${FETCH_LIMIT} fetches to protect your daily quota.\n\nProgress saved at row ${row}. Run "Update All Prices" again to continue.`, ui.ButtonSet.OK);
      return;
    }

    const setName = sheet.getRange(row, 1).getValue();
    const cardName = sheet.getRange(row, 11).getValue();
    const priceCell = sheet.getRange(row, 10);
    const existingPrice = priceCell.getValue().toString().trim();

    if (existingPrice && existingPrice !== "Not found" && existingPrice !== "Error" && existingPrice !== "Loading...") {
      continue;
    }

    if (!cardName || cardName.toString().trim() === "") {
      priceCell.setValue("");
      continue;
    }

    priceCell.setValue("Loading...");
    SpreadsheetApp.flush();

    try {
      const price = getCardPrice(cardName, setName);
      priceCell.setValue(price);
      if (price === "$0 - Verify") {
        priceCell.setBackground("#FFD700");
      } else {
        priceCell.setBackground(null);
      }
      fetchCount++;
    } catch (e) {
      priceCell.setValue("Error");
    }

    Utilities.sleep(500);
  }

  props.deleteProperty(resumeKey);
  ui.alert("Done!", `All prices on "${sheetName}" have been updated.`, ui.ButtonSet.OK);
}

function refreshAllPrices() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const sheetName = sheet.getName();
  const props = PropertiesService.getScriptProperties();
  const lastRow = sheet.getLastRow();
  const ui = SpreadsheetApp.getUi();

  const resumeKey = "refreshRow_" + sheetName;
  let startRow = parseInt(props.getProperty(resumeKey) || "2");

  if (startRow > 2) {
    const resume = ui.alert(
      "Resume?",
      `A previous refresh on "${sheetName}" stopped at row ${startRow}. Resume from there?`,
      ui.ButtonSet.YES_NO
    );
    if (resume === ui.Button.NO) startRow = 2;
  } else {
    const response = ui.alert(
      "Refresh All Prices",
      `This will re-fetch ALL prices on "${sheetName}", including ones already filled in. Continue?`,
      ui.ButtonSet.YES_NO
    );
    if (response !== ui.Button.YES) return;
  }

  const startTime = Date.now();
  const TIME_LIMIT = 5 * 60 * 1000;
  let fetchCount = 0;
  const FETCH_LIMIT = 150;

  for (let row = startRow; row <= lastRow; row++) {
    if (Date.now() - startTime > TIME_LIMIT) {
      props.setProperty(resumeKey, row.toString());
      ui.alert("Paused", `Time limit reached on "${sheetName}". Progress saved at row ${row}.\n\nRun "Refresh All Prices" again to continue.`, ui.ButtonSet.OK);
      return;
    }

    if (fetchCount >= FETCH_LIMIT) {
      props.setProperty(resumeKey, row.toString());
      ui.alert("Paused — Fetch Limit Reached", `Reached ${FETCH_LIMIT} fetches to protect your daily quota.\n\nProgress saved at row ${row}. Run "Refresh All Prices" again to continue.`, ui.ButtonSet.OK);
      return;
    }

    const setName = sheet.getRange(row, 1).getValue();
    const cardName = sheet.getRange(row, 11).getValue();
    const priceCell = sheet.getRange(row, 10);

    if (!cardName || cardName.toString().trim() === "") {
      priceCell.setValue("");
      continue;
    }

    priceCell.setValue("Loading...");
    SpreadsheetApp.flush();

    try {
      const price = getCardPrice(cardName, setName);
      priceCell.setValue(price);
      if (price === "$0 - Verify") {
        priceCell.setBackground("#FFD700");
      } else {
        priceCell.setBackground(null);
      }
      fetchCount++;
    } catch (e) {
      priceCell.setValue("Error");
    }

    Utilities.sleep(500);
  }

  props.deleteProperty(resumeKey);
  ui.alert("Done!", `All prices on "${sheetName}" have been refreshed.`, ui.ButtonSet.OK);
}

function updateSelectedRows() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const selection = sheet.getActiveRange();
  const startRow = selection.getRow();
  const endRow = selection.getLastRow();
  const ui = SpreadsheetApp.getUi();

  if (startRow < 2) {
    ui.alert("Invalid Selection", "Please select data rows only (not the header).", ui.ButtonSet.OK);
    return;
  }

  const response = ui.alert(
    "Update Selected Rows",
    `This will fetch prices for rows ${startRow} to ${endRow} (${endRow - startRow + 1} cards). Continue?`,
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  for (let row = startRow; row <= endRow; row++) {
    const setName = sheet.getRange(row, 1).getValue();
    const cardName = sheet.getRange(row, 11).getValue();
    const priceCell = sheet.getRange(row, 10);

    if (!cardName || cardName.toString().trim() === "") {
      priceCell.setValue("");
      continue;
    }

    priceCell.setValue("Loading...");
    SpreadsheetApp.flush();

    try {
      const price = getCardPrice(cardName, setName);
      priceCell.setValue(price);
      if (price === "$0 - Verify") {
        priceCell.setBackground("#FFD700");
      } else {
        priceCell.setBackground(null);
      }
    } catch (e) {
      priceCell.setValue("Error");
    }

    Utilities.sleep(500);
  }

  ui.alert("Done!", `Prices updated for rows ${startRow} to ${endRow}.`, ui.ButtonSet.OK);
}

function updateSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const row = sheet.getActiveRange().getRow();
  if (row < 2) return;

  const setName = sheet.getRange(row, 1).getValue();
  const cardName = sheet.getRange(row, 11).getValue();
  const priceCell = sheet.getRange(row, 10);

  if (!cardName || cardName.toString().trim() === "") {
    priceCell.setValue("");
    return;
  }

  priceCell.setValue("Loading...");
  SpreadsheetApp.flush();

  const price = getCardPrice(cardName, setName);
  priceCell.setValue(price);
  if (price === "$0 - Verify") {
    priceCell.setBackground("#FFD700");
  } else {
    priceCell.setBackground(null);
  }
}
