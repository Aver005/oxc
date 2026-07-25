use oxc_ast::ast::*;
use oxc_span::GetSpan;

use crate::source_text::SourceTextExt as _;
use crate::{
    ast_nodes::{AstNode, AstNodes},
    format_args,
    formatter::{
        Buffer, Format, JsFormatContext, JsFormatter, JsFormatterExt as _,
        prelude::{format_with, group, soft_block_indent_with_maybe_space, soft_line_break},
        trivia::format_dangling_comments,
    },
    options::Expand,
    print::parameters::{get_this_param, should_hug_function_parameters},
    write,
};

#[derive(Clone, Copy)]
pub enum ObjectLike<'a, 'b> {
    ObjectExpression(&'b AstNode<'a, ObjectExpression<'a>>),
    TSTypeLiteral(&'b AstNode<'a, TSTypeLiteral<'a>>),
}

impl<'a> ObjectLike<'a, '_> {
    fn span(&self) -> Span {
        match self {
            ObjectLike::ObjectExpression(o) => o.span,
            ObjectLike::TSTypeLiteral(o) => o.span,
        }
    }

    fn should_hug(&self, f: &JsFormatter<'_, 'a>) -> bool {
        // Check if the object type is the type annotation of the only parameter in a function.
        // This prevents breaking object properties in cases like:
        // const fn = ({ foo }: { foo: string }) => { ... };
        matches!(self, Self::TSTypeLiteral(node) if {
            // Check if parent is TSTypeAnnotation
            matches!(node.parent(), AstNodes::TSTypeAnnotation(type_ann) if {
                match &type_ann.parent() {
                    AstNodes::FormalParameter(param) if param.initializer.is_none() => {
                        let AstNodes::FormalParameters(parameters) = &param.parent() else {
                            unreachable!()
                        };
                        let this_param = get_this_param(parameters.parent());
                        should_hug_function_parameters(parameters, this_param, false, f)

                    }
                    AstNodes::TSThisParameter(param) => {
                        matches!(param.parent(), AstNodes::Function(func) if {
                            should_hug_function_parameters(func.params(), Some(param), false, f)
                        })
                    },
                    _ => false,
                }
            })
        })
    }

    fn members_have_leading_newline(&self, f: &JsFormatter<'_, 'a>) -> bool {
        match self {
            Self::ObjectExpression(o) => o.as_ref().properties.first().is_some_and(|p| {
                f.source_text().contains_newline_between(o.span.start, p.span().start)
            }),
            Self::TSTypeLiteral(o) => o.as_ref().members.first().is_some_and(|p| {
                f.source_text().contains_newline_between(o.span().start, p.span().start)
            }),
        }
    }

    /// `true` when moving `{` onto its own line would change what the program means.
    ///
    /// `return` / `throw` / `yield` are subject to ASI, so `return\n{ a: 1 }` is not a returned
    /// object but `return;` followed by a labelled block. The hazard is not limited to the object
    /// being the whole argument — it applies whenever the object is the argument's left-most
    /// token, as in `return { a: 1 }.a` or `return { ...a } as T`. Comparing start offsets covers
    /// every such wrapper without having to enumerate expression kinds; a parenthesised argument
    /// has a different start and is correctly left alone.
    ///
    /// Type literals never sit in an ASI-sensitive position, so only object expressions are checked.
    fn brace_break_is_unsafe(&self) -> bool {
        let Self::ObjectExpression(object) = self else { return false };
        let start = object.span.start;

        for ancestor in object.ancestors() {
            match ancestor {
                AstNodes::ReturnStatement(node) => {
                    return node.argument.as_ref().is_some_and(|it| it.span().start == start);
                }
                AstNodes::ThrowStatement(node) => return node.argument.span().start == start,
                AstNodes::YieldExpression(node) => {
                    return node.argument.as_ref().is_some_and(|it| it.span().start == start);
                }
                // Being the left-most token cannot hold across a statement or body boundary,
                // so anything found above one of these is a different expression entirely.
                AstNodes::BlockStatement(_) | AstNodes::FunctionBody(_) | AstNodes::Program(_) => {
                    return false;
                }
                _ => {}
            }
        }

        false
    }

    fn members_are_empty(&self) -> bool {
        match self {
            Self::ObjectExpression(o) => o.properties().is_empty(),
            Self::TSTypeLiteral(o) => o.members().is_empty(),
        }
    }

    fn write_members(&self, f: &mut JsFormatter<'_, 'a>) {
        match self {
            Self::ObjectExpression(o) => o.properties().fmt(f),
            Self::TSTypeLiteral(o) => o.members().fmt(f),
        }
    }
}

impl<'a> Format<'a, JsFormatContext<'a>> for ObjectLike<'a, '_> {
    fn fmt(&self, f: &mut JsFormatter<'_, 'a>) {
        let members = format_with(|f| self.write_members(f));

        if self.members_are_empty() {
            // Soft indent so the object can stay on one line if it fits:
            // a single one-line block comment stays inline without bracket spacing
            // line comments and multiple comments still expand.
            write!(f, "{");
            write!(f, format_dangling_comments(self.span()).with_soft_block_indent());
            write!(f, "}");
        } else {
            let should_insert_space_around_brackets = f.options().bracket_spacing.value();
            let should_expand =
                f.options().expand == Expand::Auto && self.members_have_leading_newline(f);

            // If the object type is the type annotation of the only parameter in a function,
            // try to hug the parameter; we don't create a group and inline the contents here.
            //
            // For example:
            // ```ts
            // const fn = ({ foo }: { foo: string }) => { ... };
            //                      ^ do not break properties here
            // ```
            let should_hug = self.should_hug(f);

            let inner =
                soft_block_indent_with_maybe_space(&members, should_insert_space_around_brackets);

            if should_hug {
                write!(f, ["{", inner, "}"]);
            } else if f.options().brace_style.breaks_before_open_brace()
                && !self.brace_break_is_unsafe()
            {
                // Allman puts `{` on a line of its own, but only once the object actually breaks —
                // an object that fits stays `{ a: 1 }` rather than exploding into three lines.
                // Tying the two together means the leading break has to sit inside the same group
                // as the members, so the braces move in with it.
                write!(
                    f,
                    [group(&format_args!(soft_line_break(), "{", inner, "}"))
                        .should_expand(should_expand)]
                );
            } else {
                write!(f, ["{", group(&inner).should_expand(should_expand), "}"]);
            }
        }
    }
}
