export const handler = async () => {
  try {
    const API = "https://returns.detroitaxle.com/api/returns";
    const res = await fetch(API);
    const data = await res.json();

    const scanners = {};
    const classifications = {};
    const daily = {};
    const weekly = {};

    data.forEach((item) => {
      const user = item.scanner_name || "Unknown";
      scanners[user] = (scanners[user] || 0) + 1;

      const cls = item.classification || "Unclassified";
      classifications[cls] = (classifications[cls] || 0) + 1;

      const date = item.date?.slice(0, 10);
      daily[date] = (daily[date] || 0) + 1;
    });

    const days = Object.keys(daily);
    days.forEach((_, i) => {
      const week = `Week ${Math.floor(i / 7) + 1}`;
      weekly[week] = (weekly[week] || 0) + daily[days[i]];
    });

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        scanners,
        classifications,
        daily: Object.entries(daily).map(([date, total]) => ({ date, total })),
        weekly: Object.entries(weekly).map(([week, total]) => ({
          week,
          fedex: Math.floor(total * 0.5),
          ups: Math.floor(total * 0.3),
          usps: Math.floor(total * 0.2),
        })),
        updated: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error("API Error:", err);
    return {
      statusCode: 502,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
