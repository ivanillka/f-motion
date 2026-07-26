import 'package:f_motion/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('sign-in and progressive brief are reachable', (tester) async {
    await tester.pumpWidget(const FMotionApp());
    expect(find.text('Email me a magic link'), findsOneWidget);
    await tester.tap(find.text('Email me a magic link'));
    await tester.pumpAndSettle();
    expect(find.text('What should this video achieve?'), findsOneWidget);
  });

  testWidgets('uses safe area and bottom navigation', (tester) async {
    await tester.pumpWidget(const FMotionApp());
    expect(find.byKey(const Key('workflow-safe-area')), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.text('Project'), findsOneWidget);
    expect(find.text('Account'), findsOneWidget);
    await tester.tap(find.text('Account'));
    await tester.pumpAndSettle();
    final navigation = tester.widget<NavigationBar>(find.byType(NavigationBar));
    expect(navigation.selectedIndex, 1);
  });
}
