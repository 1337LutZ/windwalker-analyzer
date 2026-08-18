/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import * as Types from './wcl-schema';

export type FightDamageTableQueryVariables = Exact<{
  code: string;
  fightID: number;
}>;


export type FightDamageTableQuery = { rateLimitData: { limitPerHour: number, pointsSpentThisHour: number, pointsResetIn: number } | null, reportData: { report: { table: unknown } | null } | null };

export type FightEventsQueryVariables = Exact<{
  code: string;
  fightID: number;
  sourceID: number;
  startTime: number;
  endTime: number;
}>;


export type FightEventsQuery = { rateLimitData: { limitPerHour: number, pointsSpentThisHour: number, pointsResetIn: number } | null, reportData: { report: { events: { data: unknown, nextPageTimestamp: number | null } | null } | null } | null };

export type FightPlayerDetailsQueryVariables = Exact<{
  code: string;
  fightID: number;
}>;


export type FightPlayerDetailsQuery = { rateLimitData: { limitPerHour: number, pointsSpentThisHour: number, pointsResetIn: number } | null, reportData: { report: { playerDetails: unknown } | null } | null };

export type RateLimitQueryVariables = Exact<{ [key: string]: never; }>;


export type RateLimitQuery = { rateLimitData: { limitPerHour: number, pointsSpentThisHour: number, pointsResetIn: number } | null };

export type ReportActorsQueryVariables = Exact<{
  code: string;
}>;


export type ReportActorsQuery = { rateLimitData: { limitPerHour: number, pointsSpentThisHour: number, pointsResetIn: number } | null, reportData: { report: { masterData: { actors: Array<{ id: number | null, name: string | null, type: string | null, subType: string | null, petOwner: number | null } | null> | null } | null } | null } | null };

export type ReportFightsQueryVariables = Exact<{
  code: string;
}>;


export type ReportFightsQuery = { rateLimitData: { limitPerHour: number, pointsSpentThisHour: number, pointsResetIn: number } | null, reportData: { report: { title: string, startTime: number, endTime: number, zone: { id: number, name: string, difficulties: Array<{ id: number, name: string } | null> | null } | null, fights: Array<{ id: number, name: string, encounterID: number, kill: boolean | null, difficulty: number | null, size: number | null, fightPercentage: number | null, startTime: number, endTime: number, friendlyPlayers: Array<number | null> | null, enemyNPCs: Array<{ id: number | null, gameID: number | null } | null> | null } | null> | null } | null } | null };
