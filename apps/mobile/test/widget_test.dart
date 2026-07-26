import 'package:f_motion/api.dart';
import 'package:f_motion/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class FakeApi implements ApiGateway {
  ProjectSnapshot project([int revision = 0]) => ProjectSnapshot(
    id: 'project',
    revision: revision,
    brief: {'purpose': 'Demo', 'audience': 'Teams', 'tone': 'Warm'},
    scenes: revision == 0
        ? []
        : [
            {
              'id': 'scene',
              'order': 0,
              'caption': 'Demo',
              'duration_ms': 3000,
              'focal_x': .5,
              'focal_y': .5,
              'motion': 'none',
              'audio_level': 1,
              'ducking': false,
            },
          ],
  );

  @override
  Future<void> cancel(String jobId) async {}
  @override
  Future<ProjectSnapshot> command(
    String projectId,
    int revision,
    String kind,
    JsonMap payload,
  ) async => project(revision + 1);
  @override
  Future<void> copyPexels(String projectId, String query, int id) async {}
  @override
  Future<CreatedProject> createProject(
    String brief,
  ) async => CreatedProject(project(), [
    {'id': 'direct', 'title': 'Direct', 'treatment': 'Lead with the result'},
    {'id': 'story', 'title': 'Story', 'treatment': 'Establish, turn, resolve'},
    {'id': 'rhythm', 'title': 'Rhythm', 'treatment': 'Concise visual beats'},
  ]);
  @override
  Future<Uri> download(String jobId) async =>
      Uri.parse('https://download.invalid/preview.mp4');
  @override
  Future<List<RenderEvent>> events(String jobId, String? lastEventId) async => [
    RenderEvent('1', 'complete', 100),
  ];
  @override
  Future<RenderJob> render(String projectId) async =>
      RenderJob('job', 'queued');
  @override
  Future<List<JsonMap>> searchPexels(String query) async => [];
}

TokenStorage memoryTokenStorage() {
  String? token;
  return TokenStorage(
    writeToken: (value) async => token = value,
    readToken: () async => token,
    clearToken: () async => token = null,
  );
}

void main() {
  testWidgets('sign-in and progressive brief are reachable', (tester) async {
    await tester.pumpWidget(
      FMotionApp(api: FakeApi(), tokenStorage: memoryTokenStorage()),
    );
    expect(find.text('Email me a magic link'), findsOneWidget);
    await tester.tap(find.text('Email me a magic link'));
    await tester.pumpAndSettle();
    expect(find.text('What should this video achieve?'), findsOneWidget);
  });

  testWidgets('uses safe area and bottom navigation', (tester) async {
    await tester.pumpWidget(
      FMotionApp(api: FakeApi(), tokenStorage: memoryTokenStorage()),
    );
    expect(find.byKey(const Key('workflow-safe-area')), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.text('Project'), findsOneWidget);
    expect(find.text('Account'), findsOneWidget);
    await tester.tap(find.text('Account'));
    await tester.pumpAndSettle();
    final navigation = tester.widget<NavigationBar>(find.byType(NavigationBar));
    expect(navigation.selectedIndex, 1);
  });

  testWidgets('shared API workflow reaches deterministic concepts and editor', (
    tester,
  ) async {
    await tester.pumpWidget(
      FMotionApp(api: FakeApi(), tokenStorage: memoryTokenStorage()),
    );
    await tester.tap(find.text('Email me a magic link'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), 'Launch a product');
    await tester.pump();
    final reviewBrief = find.widgetWithText(FilledButton, 'Review brief');
    expect(tester.widget<FilledButton>(reviewBrief).onPressed, isNotNull);
    await tester.tap(reviewBrief);
    await tester.pumpAndSettle();
    expect(find.text('Direct'), findsOneWidget);
    expect(find.text('Story'), findsOneWidget);
    expect(find.text('Rhythm'), findsOneWidget);
    await tester.tap(find.text('Direct'));
    await tester.pump();
    await tester.tap(find.text('Use concept'));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Approximate preview — request an accurate render to verify timing and crop.',
      ),
      findsOneWidget,
    );
  });
}
