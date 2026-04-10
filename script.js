document.getElementById("analyseBtn").addEventListener("click", runAnalysis);
document.getElementById("loadLocationBtn").addEventListener("click", loadLocationSemiAutomatic);

// ---------------- Standort / Netz ----------------
const regionalGridProfiles = {
    BW:  { region: "Baden-Württemberg", gridOperator: "Netze BW", gridPower: 800, powerPrice: 120 },
    BY:  { region: "Bayern", gridOperator: "Bayernwerk", gridPower: 900, powerPrice: 130 },
    NRW: { region: "Nordrhein-Westfalen", gridOperator: "Westnetz", gridPower: 1000, powerPrice: 125 }
};

function getRegionFromPLZ(plz) {
    const p = Number(plz.substring(0, 2));
    if (p >= 70 && p <= 79) return "BW";
    if (p >= 80 && p <= 87) return "BY";
    if (p >= 40 && p <= 59) return "NRW";
    return null;
}

function loadLocationSemiAutomatic() {
    const plz = document.getElementById("location").value.substring(0,5);
    const regionKey = getRegionFromPLZ(plz);
    if (!regionKey) return;

    const profile = regionalGridProfiles[regionKey];
    document.getElementById("gridPower").value  = profile.gridPower;
    document.getElementById("powerPrice").value = profile.powerPrice;

    document.getElementById("locationInfo").innerHTML =
        `Region: <b>${profile.region}</b><br>Netzbetreiber: ${profile.gridOperator}`;
}

// ---------------- Analyse ----------------
function runAnalysis() {

    const gridPower  = Number(document.getElementById("gridPower").value);
    const powerPrice = Number(document.getElementById("powerPrice").value);
    const baseLoad   = Number(document.getElementById("baseLoad").value);

    const chargers     = Number(document.getElementById("chargers").value);
    const chargerPower = Number(document.getElementById("chargerPower").value);
    const simultaneity = Number(document.getElementById("simultaneity").value) / 100;

    const storagePower     = Number(document.getElementById("storagePower").value);
    const storageCapacity  = Number(document.getElementById("storageCapacity").value);
    const storageCost      = Number(document.getElementById("storageCost").value);

    const siteType = document.getElementById("siteType").value;

    const chargingLoad = chargers * chargerPower * simultaneity;
    const peakWithout  = baseLoad + chargingLoad;
    const peakWith     = Math.max(0, peakWithout - storagePower);

    const costWithout = peakWithout * powerPrice;
    const costWith    = peakWith * powerPrice;
    const savings     = costWithout - costWith;

    let recommendation = "Hold";
    let recClass = "warning";

    if (peakWithout > gridPower && peakWith <= gridPower) {
        recommendation = "Go";
        recClass = "good";
    } else if (peakWith > gridPower) {
        recommendation = "No-Go";
        recClass = "bad";
    }

    document.getElementById("output").innerHTML = `
        <h3>Lastbewertung</h3>
        Peak ohne Speicher: <b>${peakWithout.toFixed(1)} kW</b><br>
        Peak mit Speicher: <b>${peakWith.toFixed(1)} kW</b>

        <h3>Kosten</h3>
        Einsparung: <b>${savings.toFixed(0)} € / Jahr</b>

        <h3>Empfehlung</h3>
        <span class="highlight ${recClass}">${recommendation}</span>
    `;

    drawPeakChart(peakWithout, peakWith);
    drawDailyLoadChart(
        baseLoad,
        chargingLoad,
        storagePower,
        storagePower,
        storageCapacity,
        siteType
    );
    drawCostChart(costWithout, costWith);
}

// ---------------- Diagramme ----------------
let peakChart, dailyLoadChart, costChart;

function drawPeakChart(a, b) {
    const ctx = document.getElementById("peakChart").getContext("2d");
    if (peakChart) peakChart.destroy();

    peakChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: ["Ohne Speicher", "Mit Speicher"],
            datasets: [{
                data: [a, b],
                backgroundColor: ["#CDD3D7", "#FFD200"]
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function drawDailyLoadChart(
    baseLoad,
    chargingLoad,
    maxChargePower,
    maxDischargePower,
    storageCapacity,
    siteType
) {
    const ctx = document.getElementById("dailyLoadChart").getContext("2d");

    const hours = [...Array(24).keys()];
    const timestep = 1;
    let soc = 0;

    const loadWithout = [];
    const loadWith = [];
    const chargeCurve = [];
    const dischargeCurve = [];

    let gridLimit;
    if (siteType === "fleet") {
        gridLimit = baseLoad + chargingLoad * 0.4;   // aggressives Peak‑Shaving abends
    } else {
        gridLimit = baseLoad + chargingLoad * 0.7;
    }

    hours.forEach(h => {
        let additional = 0;

        if (siteType === "office") {
            if (h >= 8 && h < 17) additional = chargingLoad * 0.6;
        } else if (siteType === "production") {
            if (h >= 6 && h < 16) additional = chargingLoad;
        } else if (siteType === "fleet") {
            if (h >= 17 && h < 22) additional = chargingLoad * 1.2;
        }

        const rawLoad = baseLoad + additional;
        loadWithout.push(rawLoad);

        let gridLoad = rawLoad;
        let charge = 0;
        let discharge = 0;

        // 🔋 Laden (Flotte: auch vormittags)
        if ((h < 6 || (siteType === "fleet" && h < 12)) && soc < storageCapacity) {
            charge = Math.min(maxChargePower, storageCapacity - soc);
            soc += charge * timestep;
            gridLoad += charge;
        }

        // ⚡ Entladen bei Peak
        if (rawLoad > gridLimit && soc > 0) {
            discharge = Math.min(maxDischargePower, rawLoad - gridLimit, soc);
            soc -= discharge * timestep;
            gridLoad -= discharge;
        }

        chargeCurve.push(charge);
        dischargeCurve.push(discharge);
        loadWith.push(gridLoad);
    });

    if (dailyLoadChart) dailyLoadChart.destroy();

    dailyLoadChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: hours.map(h => `${h}:00`),
            datasets: [
                {
                    label: "Ohne Speicher",
                    data: loadWithout,
                    borderColor: "#9CA3AF",
                    tension: 0.3
                },
                {
                    label: "Mit Speicher",
                    data: loadWith,
                    borderColor: "#FACC15",
                    borderWidth: 2,
                    tension: 0.3
                },
                {
                    label: "Speicher lädt",
                    data: chargeCurve,
                    borderColor: "#22C55E",
                    borderDash: [5, 5],
                    tension: 0.3
                },
                {
                    label: "Speicher entlädt",
                    data: dischargeCurve,
                    borderColor: "#EF4444",
                    borderWidth: 2,
                    borderDash: [5, 5],
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { title: { display: true, text: "Leistung (kW)" } },
                x: { title: { display: true, text: "Uhrzeit" } }
            }
        }
    });
}

function drawCostChart(a, b) {
    const ctx = document.getElementById("costChart").getContext("2d");
    if (costChart) costChart.destroy();

    costChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: ["Ohne Speicher", "Mit Speicher"],
            datasets: [{
                data: [a, b],
                backgroundColor: ["#CDD3D7", "#FFD200"]
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}
``