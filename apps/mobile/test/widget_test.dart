import 'dart:async';

import 'package:f_motion/api.dart';
import 'package:f_motion/auth.dart';
import 'package:f_motion/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeApi implements ApiGateway {
  FakeApi({this.reachable = true});

  bool reachable;
  int reachabilityChecks = 0;

  @override
  Future<bool> isReachable() async {
    reachabilityChecks += 1;
    return reachable;
  }

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

class FakeAuth implements AuthGateway {
  FakeAuth([this._accessToken]);

  final changes = StreamController<AuthSessionState>.broadcast(sync: true);
  String? _accessToken;
  int magicLinkRequests = 0;
  String? submittedEmail;

  @override
  String? get accessToken => _accessToken;

  @override
  Stream<AuthSessionState> get authStateChanges => changes.stream;

  @override
  bool get isSignedIn => _accessToken != null;

  @override
  Future<void> sendMagicLink(String email) async {
    magicLinkRequests += 1;
    submittedEmail = email;
  }

  @override
  Future<void> signInWithGoogle() async {}

  @override
  Future<void> signOut() async {
    _accessToken = null;
    changes.add(const AuthSessionState(isSignedIn: false));
  }

  void signIn(String token) {
    _accessToken = token;
    changes.add(const AuthSessionState(isSignedIn: true));
  }

  void callbackError(Object error) => changes.addError(error);
}

void main() {
  testWidgets('sign-in and progressive brief are reachable', (tester) async {
    final auth = FakeAuth();
    await tester.pumpWidget(FMotionApp(api: FakeApi(), auth: auth));
    expect(find.text('Email me a magic link'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('auth-email')),
      'person@example.com',
    );
    await tester.tap(find.text('Email me a magic link'));
    await tester.pump();
    expect(find.text('Check your inbox to continue.'), findsOneWidget);
    expect(auth.submittedEmail, 'person@example.com');
    auth.signIn('fresh-token');
    await tester.pump();
    expect(find.text('What should this video achieve?'), findsOneWidget);
  });

  testWidgets('uses safe area and bottom navigation', (tester) async {
    await tester.pumpWidget(FMotionApp(api: FakeApi(), auth: FakeAuth()));
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
      FMotionApp(api: FakeApi(), auth: FakeAuth('test-token')),
    );
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

  testWidgets('invalid email cannot send', (tester) async {
    final auth = FakeAuth();
    await tester.pumpWidget(FMotionApp(api: FakeApi(), auth: auth));
    await tester.enterText(find.byKey(const Key('auth-email')), 'not-an-email');
    await tester.tap(find.text('Email me a magic link'));
    await tester.pump();
    expect(auth.magicLinkRequests, 0);
    expect(find.text('Enter a valid email address.'), findsOneWidget);
  });

  testWidgets('missing configuration is visible and fails closed', (
    tester,
  ) async {
    await tester.pumpWidget(
      const FMotionApp(configurationError: 'Authentication is not configured.'),
    );
    expect(find.text('Authentication is not configured.'), findsOneWidget);
    final magicLink = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Email me a magic link'),
    );
    expect(magicLink.onPressed, isNull);
    await tester.enterText(
      find.byKey(const Key('auth-email')),
      'person@example.com',
    );
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();
    expect(find.text('Authentication is not configured.'), findsOneWidget);
  });

  testWidgets(
    'session arrival advances and supplies the current bearer token',
    (tester) async {
      final auth = FakeAuth();
      await tester.pumpWidget(FMotionApp(auth: auth));
      auth.signIn('refreshed-token');
      await tester.pump();
      expect(find.text('What should this video achieve?'), findsOneWidget);
      final workflow = tester.widget<WorkflowPage>(find.byType(WorkflowPage));
      final api = workflow.api as HttpApiGateway;
      expect(await api.accessToken(), 'refreshed-token');
    },
  );

  testWidgets('sign-out returns to auth', (tester) async {
    await tester.pumpWidget(
      FMotionApp(api: FakeApi(), auth: FakeAuth('test-token')),
    );
    await tester.tap(find.text('Sign out'));
    await tester.pump();
    expect(find.byKey(const Key('auth-email')), findsOneWidget);
    expect(find.text('Signed out'), findsOneWidget);
  });

  testWidgets('callback errors remain visible without leaking details', (
    tester,
  ) async {
    final auth = FakeAuth();
    await tester.pumpWidget(FMotionApp(api: FakeApi(), auth: auth));
    auth.callbackError(StateError('callback#access_token=private'));
    await tester.pump();
    expect(
      find.text('Authentication callback failed. Try again.'),
      findsOneWidget,
    );
    expect(find.textContaining('access_token'), findsNothing);
  });

  testWidgets('restores a persisted brief into the visible editor', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({'draft': 'Saved smoke draft'});
    await tester.pumpWidget(
      FMotionApp(api: FakeApi(), auth: FakeAuth('test-token')),
    );
    await tester.pumpAndSettle();
    final brief = tester.widget<TextFormField>(find.byType(TextFormField));
    expect(brief.controller?.text, 'Saved smoke draft');
  });

  testWidgets('reports API recovery without losing the local draft', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final api = FakeApi(reachable: false);
    await tester.pumpWidget(FMotionApp(api: api, auth: FakeAuth('test-token')));
    await tester.pump();
    expect(find.text('○ Reconnecting — draft kept locally'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField), 'Keep this draft');
    api.reachable = true;
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(find.text('● Connected'), findsOneWidget);
    final brief = tester.widget<TextFormField>(find.byType(TextFormField));
    expect(brief.controller?.text, 'Keep this draft');
    expect(api.reachabilityChecks, 2);
  });
}
