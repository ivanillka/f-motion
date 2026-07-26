import 'dart:convert';
import 'dart:io';
import 'package:f_motion/api.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'HTTP client sends bearer commands and resumes SSE from Last-Event-ID',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(server.close);
      final seen = <String>[];
      server.listen((request) async {
        seen.add(
          '${request.method} ${request.uri.path} ${request.headers.value('last-event-id') ?? '-'}',
        );
        expect(
          request.headers.value(HttpHeaders.authorizationHeader),
          'Bearer token',
        );
        request.response.headers.contentType = ContentType.json;
        if (request.uri.path.endsWith('/events')) {
          request.response.headers.contentType = ContentType(
            'text',
            'event-stream',
          );
          request.response.write(
            'id: 2\nevent: progress\ndata: '
            '{"job_id":"job","event_id":"2","phase":"rendering","percent":72}\n\n',
          );
        } else if (request.uri.path.endsWith('/commands')) {
          final body = Map<String, Object?>.from(
            jsonDecode(await utf8.decoder.bind(request).join()) as Map,
          );
          expect(body['base_revision'], 3);
          request.response.write(
            jsonEncode({
              'id': 'project',
              'revision': 4,
              'brief': {'purpose': 'Demo', 'audience': 'Teams', 'tone': 'Warm'},
              'scenes': <Object?>[],
            }),
          );
        } else {
          request.response.statusCode = HttpStatus.notFound;
          request.response.write(jsonEncode({'message': 'not found'}));
        }
        await request.response.close();
      });
      final client = HttpApiGateway(
        baseUri: Uri.parse('http://127.0.0.1:${server.port}'),
        accessToken: () async => 'token',
      );
      final snapshot = await client.command('project', 3, 'select_concept', {
        'concept_id': 'direct',
      });
      expect(snapshot.revision, 4);
      final events = await client.events('job', '1');
      expect(events.single.phase, 'rendering');
      expect(events.single.percent, 72);
      expect(seen, contains('GET /api/render-jobs/job/events 1'));
    },
  );
}
