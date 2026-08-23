from __future__ import annotations

import argparse
import asyncio
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from websockets.asyncio.server import ServerConnection, serve


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Favbase Agent Bridge Phase 0 WebSocket peer'
    )
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--duration-seconds', type=float, default=330.0)
    parser.add_argument('--interval-seconds', type=float, default=20.0)
    parser.add_argument('--connect-timeout-seconds', type=float, default=45.0)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--ready-file', type=Path, required=True)
    return parser.parse_args()


def has_loopback_host_permission(patterns: list[str]) -> bool:
    return any(
        pattern == '<all_urls>'
        or '127.0.0.1' in pattern
        or 'localhost' in pattern.lower()
        for pattern in patterns
    )


async def run(args: argparse.Namespace) -> dict[str, Any]:
    report: dict[str, Any] = {
        'startedAt': utc_now(),
        'configuration': {
            'host': '127.0.0.1',
            'port': args.port,
            'durationSeconds': args.duration_seconds,
            'intervalSeconds': args.interval_seconds,
        },
        'events': [],
        'errors': [],
    }
    connection_started = asyncio.Event()
    connection_finished = asyncio.Event()
    timing: dict[str, float] = {}

    async def handler(connection: ServerConnection) -> None:
        timing['connected'] = time.monotonic()
        connection_started.set()
        origin = connection.request.headers.get('Origin') if connection.request else None
        report['origin'] = origin

        async def receive_messages() -> None:
            async for raw in connection:
                received_at = time.monotonic() - timing['connected']
                try:
                    message = json.loads(raw)
                except (json.JSONDecodeError, TypeError) as error:
                    report['errors'].append(
                        f'invalid JSON at {received_at:.3f}s: {error}'
                    )
                    continue
                if not isinstance(message, dict) or not isinstance(
                    message.get('type'), str
                ):
                    report['errors'].append(
                        f'invalid message shape at {received_at:.3f}s'
                    )
                    continue
                report['events'].append(
                    {'atSeconds': round(received_at, 3), 'message': message}
                )

        receiver = asyncio.create_task(receive_messages())
        try:
            deadline = timing['connected'] + args.duration_seconds
            sequence = 1
            while time.monotonic() < deadline:
                await connection.send(json.dumps({'type': 'ping', 'seq': sequence}))
                sequence += 1
                remaining = deadline - time.monotonic()
                if remaining > 0:
                    await asyncio.sleep(min(args.interval_seconds, remaining))
        except Exception as error:
            report['errors'].append(
                f'heartbeat failed: {type(error).__name__}: {error}'
            )
        finally:
            timing['finished'] = time.monotonic()
            await connection.close(code=1000, reason='phase-0-complete')
            try:
                await asyncio.wait_for(receiver, timeout=5)
            except asyncio.TimeoutError:
                receiver.cancel()
            connection_finished.set()

    async with serve(handler, '127.0.0.1', args.port, ping_interval=None):
        args.ready_file.parent.mkdir(parents=True, exist_ok=True)
        args.ready_file.write_text('ready', encoding='ascii')
        try:
            await asyncio.wait_for(
                connection_started.wait(), timeout=args.connect_timeout_seconds
            )
            await asyncio.wait_for(
                connection_finished.wait(),
                timeout=args.duration_seconds + args.interval_seconds + 15,
            )
        except asyncio.TimeoutError:
            report['errors'].append(
                'extension did not complete the WebSocket observation window'
            )

    events = report['events']
    connected = next(
        (event['message'] for event in events if event['message']['type'] == 'connected'),
        None,
    )
    spike_result = next(
        (
            event['message']
            for event in events
            if event['message']['type'] == 'spike-result'
        ),
        None,
    )
    pongs = [event for event in events if event['message']['type'] == 'pong']
    instance_ids = {
        event['message'].get('instanceId')
        for event in events
        if event['message'].get('instanceId') is not None
    }
    pong_span = (
        pongs[-1]['atSeconds'] - pongs[0]['atSeconds'] if len(pongs) > 1 else 0
    )
    connection_duration = timing.get('finished', time.monotonic()) - timing.get(
        'connected', time.monotonic()
    )
    expected_minimum_pongs = math.floor(
        args.duration_seconds / args.interval_seconds
    )
    sw_alive = (
        connection_duration > 300
        and pong_span > 300
        and len(pongs) >= expected_minimum_pongs
        and len(instance_ids) == 1
    )

    permissions = connected.get('manifestHostPermissions', []) if connected else []
    permissions = [value for value in permissions if isinstance(value, str)]
    no_loopback_permission = not has_loopback_host_permission(permissions)
    origin_is_extension = isinstance(report.get('origin'), str) and report[
        'origin'
    ].startswith('chrome-extension://')
    checks = spike_result.get('checks', {}) if spike_result else {}
    db_proxy_ok = checks.get('dbProxy', {}).get('ok') is True
    schemas_ok = (
        checks.get('jsonSchemas', {}).get('ok') is True
        and checks.get('jsonSchemas', {}).get('toolCount') == 3
    )
    execute_ok = checks.get('execute', {}).get('ok') is True
    host_permission_not_required = (
        connected is not None and no_loopback_permission and origin_is_extension
    )
    go = all(
        (
            db_proxy_ok,
            schemas_ok,
            execute_ok,
            sw_alive,
            host_permission_not_required,
        )
    )

    report['finishedAt'] = utc_now()
    report['summary'] = {
        'dbProxyHybridRetrieve': db_proxy_ok,
        'jsonSchemaThreeTools': schemas_ok,
        'toolExecute': execute_ok,
        'serviceWorkerAliveOverFiveMinutes': sw_alive,
        'hostPermissionNotRequired': host_permission_not_required,
        'connectionDurationSeconds': round(connection_duration, 3),
        'pongSpanSeconds': round(pong_span, 3),
        'pongCount': len(pongs),
        'serviceWorkerInstanceIds': sorted(instance_ids),
        'manifestHostPermissions': permissions,
        'verdict': 'GO' if go else 'NO-GO',
    }
    return report


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    report = asyncio.run(run(args))
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(json.dumps(report['summary'], ensure_ascii=False))
    raise SystemExit(0 if report['summary']['verdict'] == 'GO' else 1)


if __name__ == '__main__':
    main()
