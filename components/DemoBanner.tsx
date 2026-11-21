/**
 * Clear banner when HVAC_DEMO=1 is serving fake data. Monitor-only.
 */

export function DemoBanner() {
  return (
    <div className="demo-banner" role="status">
      DEMO DATA — fake readings and alerts. No MQTT, collector, or database.
    </div>
  );
}
