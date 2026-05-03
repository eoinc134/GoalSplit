export interface ActivityRow {
  id: string;
  strava_id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number;       // metres
  moving_time: number;    // seconds
  total_elevation_gain: number; // metres
  average_speed: number;  // m/s
  average_heartrate: number | null;
  start_date: string;
  start_date_local: string;
}
