const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function extractText(html, regex) {
  const match = html.match(regex);
  return match ? match[1].trim() : "";
}

function extractByPatterns(html, patterns) {
  for (const pattern of patterns) {
    const value = extractText(html, pattern);
    if (value) return value;
  }
  return "";
}

function parseNumber(text) {
  if (!text) return 0;
  const cleaned = text.replace(/[−﹣]/g, "-").replace(/[^\d.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function parseStock(html, symbol) {
  const name = extractText(
    html,
    /<div class="wrap_company">[\s\S]*?<h2>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i
  );

  const priceText = extractByPatterns(html, [
    /<p class="no_today">[\s\S]*?<span class="blind">([\d,]+)<\/span>/i,
    /<dd>[\s\S]*?현재가[\s\S]*?<span class="blind">([\d,]+)<\/span>/i
  ]);

  const noExdayBlock = extractText(html, /<p class="no_exday">([\s\S]*?)<\/p>/i);
  const noExdayBlind = [...noExdayBlock.matchAll(/<span class="blind">([^<]+)<\/span>/gi)].map((m) => m[1].trim());

  const directionText =
    noExdayBlind.find((text) => text === "상승" || text === "하락" || text === "보합") ||
    extractByPatterns(html, [
      /<p class="no_exday">[\s\S]*?<span class="blind">(상승|하락|보합)<\/span>/i,
      /(상한가|상승)/i,
      /(하한가|하락)/i
    ]);

  const changeText =
    noExdayBlind.find((text) => /^[\d,]+$/.test(text)) ||
    extractByPatterns(html, [
      /<p class="no_exday">[\s\S]*?(?:상승|하락|보합)<\/span>[\s\S]*?<span class="blind">([\d,]+)<\/span>/i,
      /전일대비[\s\S]*?<span class="blind">([\d,]+)<\/span>/i
    ]);

  const rateText =
    noExdayBlind.find((text) => /[+\-−]?\d+(?:\.\d+)?%/.test(text)) ||
    extractByPatterns(html, [
      /<p class="no_exday">[\s\S]*?<span class="blind">([+\-−]?[\d.]+)%<\/span>/i,
      /등락률[\s\S]*?<span class="blind">([+\-−]?[\d.]+)%<\/span>/i
    ]);

  const volumeText = extractByPatterns(html, [
    /<span class="tah p11">거래량<\/span>[\s\S]*?<span class="blind">([\d,]+)<\/span>/i,
    /거래량[\s\S]*?<span class="tah p11">([\d,]+)<\/span>/i,
    /거래량[\s\S]*?<span class="blind">([\d,]+)<\/span>/i
  ]);

  const price = parseNumber(priceText);
  let change = parseNumber(changeText);
  let rate = parseNumber(rateText);
  const volume = parseNumber(volumeText);

  if (directionText === "하락") {
    change = -Math.abs(change);
    rate = -Math.abs(rate);
  } else if (directionText === "상승") {
    change = Math.abs(change);
    rate = Math.abs(rate);
  } else if (/하락/.test(directionText)) {
    change = -Math.abs(change);
    rate = -Math.abs(rate);
  } else if (/상승|상한가/.test(directionText)) {
    change = Math.abs(change);
    rate = Math.abs(rate);
  } else {
    if (rate < 0 || /-/.test(rateText)) {
      change = -Math.abs(change);
      rate = -Math.abs(rate);
    } else if (rate > 0 || /\+/.test(rateText)) {
      change = Math.abs(change);
      rate = Math.abs(rate);
    } else if (!change && !rate) {
      change = 0;
      rate = 0;
    }
  }

  return {
    symbol,
    name: name || symbol,
    price,
    change,
    rate,
    volume,
    timestamp: new Date().toISOString()
  };
}

module.exports = async (req, res) => {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const symbol = String(req.query.symbol || "").trim();
  if (!/^\d{6}$/.test(symbol)) {
    return res.status(400).json({ error: "Invalid symbol. Use 6-digit code." });
  }

  try {
    const targetUrl = `https://finance.naver.com/item/main.naver?code=${symbol}`;
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Naver response error: ${response.status}` });
    }

    const html = await response.text();
    const stock = parseStock(html, symbol);

    if (!stock.price) {
      return res.status(502).json({ error: "Failed to parse stock data" });
    }

    return res.status(200).json(stock);
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
};
