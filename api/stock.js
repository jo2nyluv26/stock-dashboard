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
  const cleaned = String(text).replace(/[−﹣]/g, "-").replace(/[^\d.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDirectionFromBlock(noExdayBlock) {
  if (/no_down|하락|하한가/i.test(noExdayBlock)) return -1;
  if (/no_up|상승|상한가/i.test(noExdayBlock)) return 1;
  return 0;
}

function parseChangeFromBlock(noExdayBlock) {
  const blindValues = [...noExdayBlock.matchAll(/<span class="blind">([^<]+)<\/span>/gi)].map((m) => m[1].trim());

  const blindNumber = blindValues.find((v) => /^[\d,]+$/.test(v));
  if (blindNumber) return blindNumber;

  const emBlock = extractText(noExdayBlock, /<em[^>]*>([\s\S]*?)<\/em>/i);
  const digits = [...emBlock.matchAll(/<span class="no\d+">(\d)<\/span>/gi)].map((m) => m[1]);
  if (digits.length) return digits.join("");

  return "";
}

function parseRateFromBlock(noExdayBlock) {
  return extractByPatterns(noExdayBlock, [
    /<span class="blind">([+\-−]?\d+(?:\.\d+)?)%<\/span>/i,
    /([+\-−]?\d+(?:\.\d+)?)%/i
  ]);
}

function parseVolume(html) {
  const volumeText = extractByPatterns(html, [
    /<tr[^>]*>\s*<th[^>]*>\s*<span class="tah p11">거래량<\/span>[\s\S]*?<td[^>]*>\s*<span class="tah p11">([\d,]+)<\/span>/i,
    /<tr[^>]*>\s*<th[^>]*>\s*<span class="tah p11">거래량<\/span>[\s\S]*?<td[^>]*>[\s\S]*?<span class="blind">([\d,]+)<\/span>/i,
    /<span class="tah p11">거래량<\/span>[\s\S]{0,120}?<span class="tah p11">([\d,]+)<\/span>/i
  ]);
  return parseNumber(volumeText);
}

function parseChartXml(xml) {
  const items = [...xml.matchAll(/<item data="([^"]+)"/gi)].map((m) => m[1]);
  return items
    .map((line) => {
      const [date, open, high, low, close, volume] = line.split("|");
      return {
        date,
        open: parseNumber(open),
        high: parseNumber(high),
        low: parseNumber(low),
        close: parseNumber(close),
        volume: parseNumber(volume)
      };
    })
    .filter((d) => d.close > 0);
}

function parseStock(html, symbol) {
  const name = extractText(
    html,
    /<div class="wrap_company">[\s\S]*?<h2>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i
  );

  const text = htmlToText(html);
  const textQuoteMatch = text.match(
    /현재가\s*([\d,]+)\s*전일대비\s*(상승|하락|보합)\s*([\d,]+)\s*(?:마이너스|플러스)?\s*([+\-]?\d+(?:\.\d+)?)\s*퍼센트/i
  );
  const textVolumeMatch = text.match(/거래량\s*([\d,]+)/i);

  const priceText = extractByPatterns(html, [
    /<p class="no_today">[\s\S]*?<span class="blind">([\d,]+)<\/span>/i,
    /<dd>[\s\S]*?현재가[\s\S]*?<span class="blind">([\d,]+)<\/span>/i
  ]);

  const noExdayBlock = extractText(html, /<p class="no_exday">([\s\S]*?)<\/p>/i);
  const direction = parseDirectionFromBlock(noExdayBlock);
  const changeText = parseChangeFromBlock(noExdayBlock);
  const rateText = parseRateFromBlock(noExdayBlock);

  const price = parseNumber(textQuoteMatch?.[1] || priceText);
  let change = Math.abs(parseNumber(changeText));
  let rate = parseNumber(textQuoteMatch?.[4] || rateText);
  const volume = parseNumber(textVolumeMatch?.[1]) || parseVolume(html);

  if (textQuoteMatch) {
    const dirWord = textQuoteMatch[2];
    change = Math.abs(parseNumber(textQuoteMatch[3]));
    if (dirWord === "하락") {
      change = -Math.abs(change);
      rate = -Math.abs(rate);
    } else if (dirWord === "상승") {
      change = Math.abs(change);
      rate = Math.abs(rate);
    } else {
      change = 0;
    }
  } else {
    if (rateText) {
      if (/^-/.test(rateText) || /−/.test(rateText)) rate = -Math.abs(rate);
      else if (/^\+/.test(rateText)) rate = Math.abs(rate);
      else if (direction < 0) rate = -Math.abs(rate);
      else if (direction > 0) rate = Math.abs(rate);
    } else {
      rate = 0;
    }

    if (direction < 0) change = -Math.abs(change);
    else if (direction > 0) change = Math.abs(change);
    else if (rate < 0) change = -Math.abs(change);
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

    let chart = [];
    try {
      const chartUrl = `https://fchart.stock.naver.com/sise.nhn?symbol=${symbol}&timeframe=day&count=40&requestType=0`;
      const chartResponse = await fetch(chartUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Referer: targetUrl
        }
      });
      if (chartResponse.ok) {
        const xml = await chartResponse.text();
        chart = parseChartXml(xml);
      }
    } catch {
      chart = [];
    }

    if (!stock.price) {
      return res.status(502).json({ error: "Failed to parse stock data" });
    }

    return res.status(200).json({ ...stock, chart });
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
};
